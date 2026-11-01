import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { decodeText, encodeText, normalizeNewlines } from './encoding.mjs';
import { atomicWriteFile } from './fs-safe.mjs';
import { sha256 } from './hash.mjs';
import {
  appendBlock,
  blockContentHash,
  findBlock,
  planBlockMerge,
  removeBlock,
  replaceBlock
} from './merge-engine.mjs';
import { resolvePath } from './paths.mjs';
import { formatLocalIso, formatStamp } from './time.mjs';

export const PROJECT_MODES = ['auto', 'local', 'append'];

const MODE_FILES = {
  auto: 'AGENTS.md',
  local: 'AGENTS.local.md',
  append: 'AGENTS.md'
};

/**
 * 展开并规范化项目路径。
 * @param {string} value 项目路径
 * @returns {string} 绝对路径
 */
export function normalizeProjectPath(value) {
  return path.resolve(resolvePath(value));
}

/**
 * 读取项目挂载指针正文，并替换为当前工作台入口路径。
 * @param {string} repoRoot 仓库根目录
 * @returns {string} 指针正文
 */
export function readProjectBlockInner(repoRoot) {
  const templatePath = path.join(repoRoot, 'content', 'templates', 'project-block.md');
  const template = normalizeNewlines(fs.readFileSync(templatePath, 'utf8'));
  const found = findBlock(template);
  if (found.status !== 'present') {
    throw new Error(`项目挂载模板缺少完整工作台块：${templatePath}`);
  }

  const entryPath = path.join(repoRoot, 'dist', 'ENTRY.md');
  return found.inner.replaceAll('{{entryPath}}', entryPath).trim();
}

/**
 * 列出机器档案中的项目父级；支持用分号分隔多个目录。
 * @param {object} machine 机器档案
 * @returns {string[]} 绝对路径
 */
export function listProjectRoots(machine) {
  const value = machine.paths['项目父级'];
  if (!value) return [];
  return value
    .split(/[;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeProjectPath);
}

/**
 * 收集可挂载的项目候选：项目父级下的 git 仓库，以及机器档案项目清单。
 * @param {object} machine 机器档案
 * @param {{root?: string}} [options] 选项
 * @returns {{roots: string[], source: string, candidates: Array<object>, warnings: string[]}} 候选列表
 */
export function projectCandidates(machine, options = {}) {
  const roots = options.root ? [normalizeProjectPath(options.root)] : listProjectRoots(machine);
  const source = options.root ? 'option' : 'machine';
  const candidates = [];
  const warnings = [];
  const seen = new Set();

  const add = (projectPath, name, origin) => {
    const normalized = normalizeProjectPath(projectPath);
    const key = projectKey(normalized);
    if (seen.has(key)) {
      const existing = candidates.find((item) => projectKey(item.path) === key);
      if (existing && name && !existing.name) existing.name = name;
      return;
    }
    seen.add(key);
    candidates.push({ path: normalized, name: name || path.basename(normalized), origin });
  };

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      warnings.push(`项目父级不存在：${root}`);
      continue;
    }
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (error) {
      warnings.push(`无法读取项目父级 ${root}：${error.message}`);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.join(root, entry.name);
      if (!fs.existsSync(path.join(projectPath, '.git'))) continue;
      add(projectPath, entry.name, 'git');
    }
  }

  if (!options.root) {
    for (const row of machine.projects ?? []) {
      const value = row['路径'];
      if (!value) continue;
      add(value, row['名称'], 'machine');
    }
  }

  return { roots, source, candidates, warnings };
}

/**
 * 判断路径是否属于机器档案允许挂载的项目集合。
 * @param {object} machine 机器档案
 * @param {string} value 待判断路径
 * @returns {boolean} 是否允许
 */
export function isAllowedProjectPath(machine, value) {
  const target = normalizeProjectPath(value);
  return projectCandidates(machine).candidates.some((candidate) => samePath(candidate.path, target));
}

/**
 * 扫描项目并给出挂载状态，不写入任何文件。
 * @param {{repoRoot: string, machine: object, state: object, root?: string}} options 输入
 * @returns {ReturnType<typeof summarizeScan>} 扫描结果
 */
export function scanProjects({ repoRoot, machine, state, root }) {
  const { roots, source, candidates, warnings } = projectCandidates(machine, { root });
  const desiredHash = blockContentHash(readProjectBlockInner(repoRoot));
  const buildExists = fs.existsSync(path.join(repoRoot, 'dist', 'ENTRY.md'));
  const projects = candidates.map((candidate) =>
    inspectProject({ repoRoot, state, candidate, desiredHash, buildExists })
  );

  return summarizeScan({ roots, source, projects, warnings, desiredHash, buildExists });
}

/**
 * 检查单个已记录项目的挂载状态，供 doctor 使用；不写入。
 * @param {{repoRoot: string, machine: object, state: object, projectPath: string}} options 输入
 * @returns {object} 项目状态
 */
export function inspectRecordedProject({ repoRoot, machine, state, projectPath }) {
  const normalized = normalizeProjectPath(projectPath);
  const desiredHash = blockContentHash(readProjectBlockInner(repoRoot));
  const buildExists = fs.existsSync(path.join(repoRoot, 'dist', 'ENTRY.md'));
  return inspectProject({
    repoRoot,
    state,
    candidate: { path: normalized, name: projectName(machine, normalized), origin: 'record' },
    desiredHash,
    buildExists
  });
}

/**
 * 规划项目挂载；默认写入 AGENTS.md，local 模式写 AGENTS.local.md。
 * @param {{
 *   repoRoot: string,
 *   projectPath: string,
 *   mode?: string,
 *   machine: object,
 *   state: object
 * }} options 输入
 * @returns {object} 挂载计划
 */
export function planProjectAttach({ repoRoot, projectPath, mode = 'auto', machine, state }) {
  if (!PROJECT_MODES.includes(mode)) {
    throw new Error(`未知挂载方式：${mode}。可选：${PROJECT_MODES.join(', ')}`);
  }

  const normalized = normalizeProjectPath(projectPath);
  const file = MODE_FILES[mode];
  const targetPath = path.join(normalized, file);
  const record = findProjectRecord(state, normalized);
  const desiredHash = blockContentHash(readProjectBlockInner(repoRoot));
  const buildExists = fs.existsSync(path.join(repoRoot, 'dist', 'ENTRY.md'));
  const base = {
    projectPath: normalized,
    name: projectName(machine, normalized),
    mode,
    file,
    targetPath,
    buildExists,
    recorded: Boolean(record),
    storedBlockHash: record?.blockHash ?? null,
    storedAction: record?.action ?? null,
    storedExcludeAdded: Boolean(record?.excludeAdded),
    blockHash: desiredHash,
    tracked: null,
    canApply: false,
    canForce: false,
    status: 'blocked',
    action: 'blocked',
    reason: null,
    exclude: null,
    fingerprint: null
  };

  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
    return { ...base, reason: `项目目录不存在：${normalized}` };
  }

  const current = readProjectFile(targetPath);
  if (current.exists && current.text === null) {
    return { ...base, reason: `入口不是 UTF-8 文本：${targetPath}` };
  }

  const git = inspectGit(normalized, file);
  const recordedFile = record?.file ?? (record?.mode ? MODE_FILES[record.mode] : null);
  if (recordedFile && recordedFile !== file) {
    const found = current.text === null ? null : findBlock(current.text);
    const plan = {
      ...base,
      tracked: git.tracked,
      git: { isRepo: git.isRepo, excludePath: git.excludePath, warning: git.warning },
      status: 'blocked',
      action: 'blocked',
      reason: `项目已通过 ${recordedFile} 挂载${
        record.mode ? `（${record.mode}）` : ''
      }；要改用 ${file}，请先取消挂载（detach）再重新挂载（attach）。`,
      exclude: planExclude({
        projectPath: normalized,
        fileName: file,
        git,
        enabled: false
      }),
      currentHash: current.hash,
      foundBlockHash: found?.blockHash ?? null,
      blockText: null,
      replacement: null
    };
    plan.canApply = false;
    plan.fingerprint = projectFingerprint(plan);
    return plan;
  }

  const merge = planBlockMerge({
    existingText: current.exists ? current.text : null,
    newInner: readProjectBlockInner(repoRoot),
    storedBlockHash: record?.blockHash ?? null
  });

  let action = merge.action;
  let reason = merge.reason;
  if (merge.action === 'manual') {
    action = 'blocked';
  }
  if (record && merge.action === 'append-block') {
    action = 'blocked';
    reason = '挂载记录存在但入口中没有工作台块，可能被手工删除；请先确认或使用 detach --force 清理记录';
  }
  if (!buildExists && action !== 'unchanged') {
    action = 'blocked';
    reason = '构建产物 dist/ENTRY.md 不存在；先运行 aiwb build';
  }

  const modifies = ['create-file', 'append-block', 'update-block'].includes(action);
  if (modifies && git.tracked !== false && mode !== 'append') {
    action = 'blocked';
    const alternative =
      mode === 'local'
        ? '确认后用 --mode append 写 AGENTS.md'
        : '可改用 AGENTS.local.md 未被跟踪的 --mode local，或确认后用 --mode append';
    reason =
      git.tracked === true
        ? `${file} 已被 git 跟踪，默认不改；${alternative}`
        : `无法判断 ${file} 是否被 git 跟踪，默认不改；${alternative}`;
  }

  const exclude = planExclude({
    projectPath: normalized,
    fileName: file,
    git,
    enabled: action !== 'blocked'
  });

  const plan = {
    ...base,
    tracked: git.tracked,
    git: { isRepo: git.isRepo, excludePath: git.excludePath, warning: git.warning },
    status: action === 'blocked' ? 'blocked' : 'ready',
    action,
    reason,
    exclude,
    currentHash: current.hash,
    foundBlockHash: current.text === null ? null : findBlock(current.text).blockHash ?? null,
    blockText: merge.blockText ?? null,
    replacement: merge.replacement ?? null
  };

  plan.canApply = plan.status === 'ready';
  plan.fingerprint = projectFingerprint(plan);
  return plan;
}

/**
 * 规划项目取消挂载；只读文件，不写入。
 * @param {{
 *   repoRoot: string,
 *   projectPath: string,
 *   state: object,
 *   force?: boolean,
 *   machine?: object
 * }} options 输入
 * @returns {object} 取消挂载计划
 */
export function planProjectDetach({ repoRoot, projectPath, state, force = false, machine }) {
  const normalized = normalizeProjectPath(projectPath);
  const record = findProjectRecord(state, normalized);
  const desiredHash = blockContentHash(readProjectBlockInner(repoRoot));
  const base = {
    projectPath: normalized,
    name: projectName(machine, normalized),
    mode: record?.mode ?? 'auto',
    file: record?.file ?? null,
    targetPath: null,
    recorded: Boolean(record),
    storedBlockHash: record?.blockHash ?? null,
    blockHash: desiredHash,
    currentHash: null,
    foundBlockHash: null,
    tracked: null,
    status: 'absent',
    action: 'absent',
    reason: null,
    canApply: false,
    canForce: false,
    force,
    exclude: null,
    fingerprint: null
  };

  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
    return {
      ...base,
      status: record ? 'absent' : 'absent',
      action: 'absent',
      reason: '项目目录不存在',
      canApply: Boolean(record)
    };
  }

  const fileNames = record?.file ? [record.file] : ['AGENTS.md', 'AGENTS.local.md'];
  const inspected = fileNames.map((fileName) => {
    const targetPath = path.join(normalized, fileName);
    const current = readProjectFile(targetPath);
    const found = current.text === null ? null : findBlock(current.text);
    return { fileName, targetPath, current, found };
  });

  if (!record) {
    const present = inspected.filter((item) => item.found?.status === 'present');
    const malformed = inspected.find((item) => item.found?.status === 'malformed');
    if (malformed) {
      return {
        ...base,
        file: malformed.fileName,
        targetPath: malformed.targetPath,
        tracked: inspectGit(normalized, malformed.fileName).tracked,
        status: 'blocked',
        action: 'blocked',
        reason: malformed.found.reason
      };
    }
    if (present.length > 1) {
      return {
        ...base,
        file: null,
        status: 'blocked',
        action: 'blocked',
        reason: '两个项目入口都含工作台块，且没有挂载记录；先确认要移除哪一个'
      };
    }
    if (present.length === 0) {
      return { ...base, status: 'absent', action: 'absent', reason: '没有工作台块' };
    }

    const item = present[0];
    const tracked = inspectGit(normalized, item.fileName).tracked;
    if (!force) {
      return {
        ...base,
        file: item.fileName,
        targetPath: item.targetPath,
        tracked,
        currentHash: item.current.hash,
        foundBlockHash: item.found.blockHash,
        status: 'blocked',
        action: 'blocked',
        reason: '没有挂载记录；确认移除时加 --force',
        canForce: true
      };
    }
    const plan = {
      ...base,
      file: item.fileName,
      targetPath: item.targetPath,
      tracked,
      currentHash: item.current.hash,
      foundBlockHash: item.found.blockHash,
      status: 'remove-block',
      action: 'remove-block',
      reason: '没有挂载记录，按 --force 移除工作台块并保留文件',
      canApply: true,
      canForce: true
    };
    plan.fingerprint = projectFingerprint(plan);
    return plan;
  }

  const item = inspected[0];
  const tracked = inspectGit(normalized, item.fileName).tracked;
  const exclude = planExcludeRemoval({
    projectPath: normalized,
    fileName: item.fileName,
    record,
    git: inspectGit(normalized, item.fileName)
  });

  if (!item.current.exists) {
    const plan = {
      ...base,
      file: item.fileName,
      targetPath: item.targetPath,
      tracked,
      status: 'absent',
      action: 'absent',
      reason: '挂载记录对应的入口不存在',
      canApply: true,
      exclude
    };
    plan.fingerprint = projectFingerprint(plan);
    return plan;
  }
  if (item.current.text === null) {
    return {
      ...base,
      file: item.fileName,
      targetPath: item.targetPath,
      tracked,
      status: 'blocked',
      action: 'blocked',
      reason: `入口不是 UTF-8 文本：${item.targetPath}`
    };
  }
  if (item.found.status === 'malformed') {
    return {
      ...base,
      file: item.fileName,
      targetPath: item.targetPath,
      tracked,
      status: 'blocked',
      action: 'blocked',
      reason: item.found.reason
    };
  }
  if (item.found.status === 'absent') {
    const plan = {
      ...base,
      file: item.fileName,
      targetPath: item.targetPath,
      tracked,
      status: 'absent',
      action: 'absent',
      reason: '入口中没有工作台块',
      canApply: true,
      exclude
    };
    plan.fingerprint = projectFingerprint(plan);
    return plan;
  }

  if (item.found.blockHash !== record.blockHash) {
    if (!force) {
      return {
        ...base,
        file: item.fileName,
        targetPath: item.targetPath,
        tracked,
        currentHash: item.current.hash,
        foundBlockHash: item.found.blockHash,
        status: 'blocked',
        action: 'blocked',
        reason: '工作台块与挂载记录不一致，可能被手改；确认移除时加 --force',
        canForce: true,
        exclude
      };
    }
  }

  const remaining = removeBlock(item.current.text);
  const deleteFile =
    item.found.blockHash === record.blockHash &&
    record.action === 'create-file' &&
    remaining.trim() === '';
  const plan = {
    ...base,
    file: item.fileName,
    targetPath: item.targetPath,
    tracked,
    currentHash: item.current.hash,
    foundBlockHash: item.found.blockHash,
    status: deleteFile ? 'delete-file' : 'remove-block',
    action: deleteFile ? 'delete-file' : 'remove-block',
    reason:
      item.found.blockHash !== record.blockHash
        ? '工作台块与挂载记录不一致，将按 --force 移除并保留文件'
        : deleteFile
          ? '工作台创建的入口移除块后为空，将删除文件'
          : '将移除入口中的工作台块，保留文件其余内容',
    canApply: true,
    exclude,
    resultText: remaining
  };
  plan.fingerprint = projectFingerprint(plan);
  return plan;
}

/**
 * 按计划写入项目入口；返回备份与写后哈希。
 * @param {{repoRoot: string, plan: object, now?: Date}} options 输入
 * @returns {{action: string, changed: boolean, backup: string|null, blockHash: string, fileHash: string}} 写入结果
 */
export function writeProjectEntry({ repoRoot, plan, now = new Date() }) {
  if (!['create-file', 'append-block', 'update-block'].includes(plan.action)) {
    throw new Error(`项目入口动作不能直接写入：${plan.action}`);
  }

  const current = readProjectFile(plan.targetPath);
  if (current.hash !== plan.currentHash) {
    throw new Error(`项目入口在预演后发生变化，未写入：${plan.targetPath}`);
  }

  let nextText;
  if (plan.action === 'create-file') {
    nextText = `${plan.blockText}\n`;
  } else {
    if (current.text === null) {
      throw new Error(`项目入口不是可写文本：${plan.targetPath}`);
    }
    nextText =
      plan.action === 'append-block'
        ? appendBlock(current.text, plan.blockText)
        : replaceBlock(current.text, plan.replacement);
  }

  const buffer = encodeText(nextText, {
    encoding: current.exists ? current.encoding : 'utf-8',
    hasBom: current.exists ? current.hasBom : false
  });
  const backup = current.exists
    ? createProjectBackup(repoRoot, {
        projectPath: plan.projectPath,
        targetPath: plan.targetPath,
        action: plan.action,
        now
      })
    : null;

  try {
    atomicWriteFile(plan.targetPath, buffer);
    verifyProjectEntry(plan.targetPath, buffer, plan.blockHash);
  } catch (error) {
    restoreProjectEntry(backup, plan.targetPath, current.exists);
    throw error;
  }

  return {
    action: plan.action,
    changed: true,
    backup: backup?.relativeDir ?? null,
    backupHandle: backup,
    blockHash: plan.blockHash,
    fileHash: sha256(buffer)
  };
}

/**
 * 移除项目入口中的工作台块，保留文件其余内容。
 * @param {{repoRoot: string, plan: object, now?: Date}} options 输入
 * @returns {{action: string, changed: boolean, backup: string|null}} 移除结果
 */
export function removeProjectEntry({ repoRoot, plan, now = new Date() }) {
  const current = readProjectFile(plan.targetPath);
  if (current.hash !== plan.currentHash) {
    throw new Error(`项目入口在预演后发生变化，未移除：${plan.targetPath}`);
  }
  if (current.text === null) {
    throw new Error(`项目入口不是可写文本：${plan.targetPath}`);
  }

  const nextText = removeBlock(current.text);
  const buffer = encodeText(nextText, { encoding: current.encoding, hasBom: current.hasBom });
  const backup = createProjectBackup(repoRoot, {
    projectPath: plan.projectPath,
    targetPath: plan.targetPath,
    action: 'detach',
    now
  });

  try {
    atomicWriteFile(plan.targetPath, buffer);
    const written = fs.readFileSync(plan.targetPath);
    if (sha256(written) !== sha256(buffer)) throw new Error('项目入口写后字节校验不一致');
    const decoded = decodeText(written);
    if (decoded.text === null || findBlock(decoded.text).status !== 'absent') {
      throw new Error('项目入口写后仍包含工作台块');
    }
  } catch (error) {
    restoreProjectEntry(backup, plan.targetPath, true);
    throw error;
  }

  return { action: 'remove-block', changed: true, backup: backup.relativeDir, backupHandle: backup };
}

/**
 * 删除项目入口并保留备份。
 * @param {{repoRoot: string, plan: object, now?: Date}} options 输入
 * @returns {{action: string, changed: boolean, backup: string|null}} 删除结果
 */
export function deleteProjectEntry({ repoRoot, plan, now = new Date() }) {
  const current = readProjectFile(plan.targetPath);
  if (current.hash !== plan.currentHash) {
    throw new Error(`项目入口在预演后发生变化，未删除：${plan.targetPath}`);
  }

  const backup = createProjectBackup(repoRoot, {
    projectPath: plan.projectPath,
    targetPath: plan.targetPath,
    action: 'detach-delete',
    now
  });
  fs.rmSync(plan.targetPath, { force: true });
  if (fs.existsSync(plan.targetPath)) {
    throw new Error(`删除项目入口失败：${plan.targetPath}`);
  }
  return { action: 'delete-file', changed: true, backup: backup.relativeDir, backupHandle: backup };
}

/**
 * 按计划写入或移除 exclude 行。
 * @param {object|null} exclude exclude 计划
 * @returns {{action: string, changed: boolean}} 写入结果
 */
export function applyProjectExclude(exclude) {
  if (!exclude || !['add', 'remove'].includes(exclude.action)) {
    return { action: exclude?.action ?? 'none', changed: false };
  }

  const existed = fs.existsSync(exclude.path);
  const current = existed ? fs.readFileSync(exclude.path, 'utf8') : '';
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const lines = current.split(/\r?\n/);
  let next;

  if (exclude.action === 'add') {
    const base = current.length > 0 && !current.endsWith('\n') ? `${current}${newline}` : current;
    next = `${base}${exclude.line}${newline}`;
  } else {
    const hadTrailing = /\r?\n$/.test(current);
    const kept = lines.filter((line) => line.trim() !== exclude.line);
    next = kept.join(newline);
    if (hadTrailing && next.length > 0 && !next.endsWith(newline)) next += newline;
  }

  atomicWriteFile(exclude.path, next, 'utf8');
  const written = fs.readFileSync(exclude.path, 'utf8');
  const present = written.split(/\r?\n/).some((line) => line.trim() === exclude.line);
  if (exclude.action === 'add' ? !present : present) {
    throw new Error(`exclude 校验失败：${exclude.path}`);
  }
  return { action: exclude.action === 'add' ? 'added' : 'removed', changed: true };
}

/**
 * 恢复项目入口备份；备份不存在时删除新建文件。
 * @param {object|null} backup 备份
 * @param {string} targetPath 入口路径
 * @param {boolean} existed 写入前是否存在
 */
export function restoreProjectEntry(backup, targetPath, existed) {
  if (backup?.filePath) {
    atomicWriteFile(targetPath, fs.readFileSync(backup.filePath));
    return;
  }
  if (!existed) fs.rmSync(targetPath, { force: true });
}

function inspectProject({ repoRoot, state, candidate, desiredHash, buildExists }) {
  const record = findProjectRecord(state, candidate.path);
  const file = record?.file ?? 'AGENTS.md';
  const targetPath = path.join(candidate.path, file);
  const git = inspectGit(candidate.path, file);
  const tracked = git.tracked;
  const excludePresent = hasExcludeLine(git, file);
  const base = {
    path: candidate.path,
    name: candidate.name,
    origin: candidate.origin,
    mode: record?.mode ?? 'auto',
    file,
    targetPath,
    recorded: Boolean(record),
    tracked,
    isRepo: git.isRepo,
    gitWarning: git.warning,
    status: 'not-mounted',
    label: '未挂载',
    blockHash: null,
    excludePresent
  };

  if (!fs.existsSync(candidate.path) || !fs.statSync(candidate.path).isDirectory()) {
    return { ...base, status: 'missing', label: '目录缺失' };
  }

  const current = readProjectFile(targetPath);
  if (!current.exists) {
    return {
      ...base,
      status: record ? 'missing-entry' : 'not-mounted',
      label: record ? '入口缺失' : '未挂载'
    };
  }
  if (current.text === null) {
    return { ...base, status: 'unsupported', label: '编码不支持' };
  }

  const found = findBlock(current.text);
  if (found.status === 'malformed') {
    return { ...base, status: 'malformed', label: '块标记异常' };
  }

  if (found.status === 'absent') {
    if (record) {
      return { ...base, status: 'missing-block', label: '块缺失' };
    }
    return tracked
      ? { ...base, status: 'tracked', label: '文件已跟踪' }
      : { ...base, status: 'not-mounted', label: '未挂载' };
  }

  if (!record) {
    return {
      ...base,
      status: 'unmanaged',
      label: '有块无记录',
      blockHash: found.blockHash
    };
  }
  if (found.blockHash !== record.blockHash) {
    return {
      ...base,
      status: 'drift',
      label: '块被手改',
      blockHash: found.blockHash
    };
  }

  return {
    ...base,
    status: found.blockHash === desiredHash ? 'mounted' : 'stale',
    label: found.blockHash === desiredHash ? '已挂载' : '指针待更新',
    blockHash: found.blockHash
  };
}

function summarizeScan({ roots, source, projects, warnings, desiredHash, buildExists }) {
  const summary = {
    total: projects.length,
    mounted: 0,
    stale: 0,
    drift: 0,
    missingBlock: 0,
    missingEntry: 0,
    unmanaged: 0,
    tracked: 0,
    notMounted: 0,
    missing: 0,
    malformed: 0,
    unsupported: 0
  };
  const map = {
    mounted: 'mounted',
    stale: 'stale',
    drift: 'drift',
    'missing-block': 'missingBlock',
    'missing-entry': 'missingEntry',
    unmanaged: 'unmanaged',
    tracked: 'tracked',
    'not-mounted': 'notMounted',
    missing: 'missing',
    malformed: 'malformed',
    unsupported: 'unsupported'
  };
  for (const project of projects) {
    const key = map[project.status];
    if (key) summary[key] += 1;
  }
  return { roots, source, projects, summary, warnings, desiredHash, buildExists };
}

function readProjectFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, hash: null, text: null, encoding: 'utf-8', hasBom: false };
  }
  const buffer = fs.readFileSync(filePath);
  const decoded = decodeText(buffer);
  return {
    exists: true,
    hash: sha256(buffer),
    text: decoded.text,
    encoding: decoded.encoding,
    hasBom: decoded.hasBom
  };
}

function inspectGit(projectPath, fileName) {
  const gitPath = path.join(projectPath, '.git');
  const base = { isRepo: false, tracked: false, excludePath: null, warning: null };
  if (!fs.existsSync(gitPath)) return base;

  let stat;
  try {
    stat = fs.lstatSync(gitPath);
  } catch (error) {
    return { ...base, warning: `无法读取 .git：${error.message}` };
  }

  if (stat.isDirectory()) {
    base.isRepo = true;
    base.excludePath = path.join(gitPath, 'info', 'exclude');
  } else {
    return {
      ...base,
      isRepo: true,
      tracked: null,
      warning: '工作树或子模块的 .git 文件未解析，exclude 需人工处理'
    };
  }

  const tracked = gitTracked(projectPath, fileName);
  return { ...base, tracked: tracked.exists ? tracked.value : null, warning: tracked.warning };
}

function gitTracked(projectPath, fileName) {
  const result = spawnSync(
    'git',
    ['-C', projectPath, 'ls-files', '--error-unmatch', '--', fileName],
    { encoding: 'utf8', windowsHide: true }
  );
  if (result.error) {
    return { exists: false, warning: `无法执行 git：${result.error.message}` };
  }
  if (result.status === 0) return { exists: true, value: true };
  if (result.status === 1) return { exists: true, value: false };
  return { exists: false, warning: `无法判断 git 跟踪状态：${(result.stderr ?? '').trim()}` };
}

function hasExcludeLine(git, fileName) {
  if (!git.excludePath || !fs.existsSync(git.excludePath)) return false;
  const line = `/${fileName}`;
  return fs
    .readFileSync(git.excludePath, 'utf8')
    .split(/\r?\n/)
    .some((item) => item.trim() === line);
}

function planExclude({ projectPath, fileName, git, enabled }) {
  const line = `/${fileName}`;
  if (!enabled) {
    return { action: 'skip', line, path: git.excludePath, reason: '入口不可写，不处理 exclude' };
  }
  if (!git.isRepo) {
    return { action: 'none', line, path: null, reason: '不是 git 仓库，无需 exclude' };
  }
  if (git.tracked !== false) {
    return {
      action: 'skip',
      line,
      path: git.excludePath,
      reason: git.tracked === true ? '文件已被 git 跟踪，exclude 不生效' : '无法判断 git 跟踪状态'
    };
  }
  if (!git.excludePath) {
    return { action: 'skip', line, path: null, reason: '无法定位 .git/info/exclude' };
  }

  const present = hasExcludeLine(git, fileName);
  return present
    ? { action: 'unchanged', line, path: git.excludePath, reason: 'exclude 行已存在' }
    : { action: 'add', line, path: git.excludePath, reason: '将把入口加入 .git/info/exclude' };
}

function planExcludeRemoval({ projectPath, fileName, record, git }) {
  const line = `/${fileName}`;
  if (!record.excludeAdded) {
    return { action: 'none', line, path: git.excludePath, reason: '挂载记录未添加 exclude' };
  }
  if (!git.excludePath || !fs.existsSync(git.excludePath)) {
    return { action: 'none', line, path: git.excludePath, reason: 'exclude 文件不存在' };
  }
  const present = fs
    .readFileSync(git.excludePath, 'utf8')
    .split(/\r?\n/)
    .some((item) => item.trim() === line);
  return present
    ? { action: 'remove', line, path: git.excludePath, reason: '将移除 exclude 行' }
    : { action: 'unchanged', line, path: git.excludePath, reason: 'exclude 行已不存在' };
}

function findProjectRecord(state, projectPath) {
  const key = projectKey(projectPath);
  for (const [recordPath, record] of Object.entries(state.projects ?? {})) {
    if (projectKey(recordPath) === key) return { ...record, recordPath };
  }
  return null;
}

function projectName(machine, projectPath) {
  const key = projectKey(projectPath);
  const row = (machine.projects ?? []).find(
    (item) => item['路径'] && projectKey(normalizeProjectPath(item['路径'])) === key
  );
  return row?.['名称'] || path.basename(projectPath);
}

function projectKey(value) {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function samePath(left, right) {
  return projectKey(left) === projectKey(right);
}

function projectFingerprint(plan) {
  return JSON.stringify({
    path: projectKey(plan.projectPath),
    mode: plan.mode,
    file: plan.file,
    action: plan.action,
    currentHash: plan.currentHash,
    storedBlockHash: plan.storedBlockHash,
    tracked: plan.tracked,
    exclude: plan.exclude?.action ?? null
  });
}

function verifyProjectEntry(targetPath, expectedBuffer, expectedBlockHash) {
  const written = fs.readFileSync(targetPath);
  if (sha256(written) !== sha256(expectedBuffer)) {
    throw new Error('项目入口写后字节校验不一致');
  }
  const decoded = decodeText(written);
  if (decoded.text === null) {
    throw new Error('项目入口写后无法解码为文本');
  }
  const found = findBlock(decoded.text);
  if (found.status !== 'present' || found.blockHash !== expectedBlockHash) {
    throw new Error('项目入口写后块校验失败');
  }
}

function createProjectBackup(repoRoot, { projectPath, targetPath, action, now }) {
  const key = sha256(Buffer.from(projectKey(projectPath), 'utf8')).slice(7, 19);
  const baseDir = path.join(repoRoot, 'state', 'project-backups', `project-${key}`);
  const dir = uniqueDir(baseDir, formatStamp(now));
  const fileName = path.basename(targetPath);
  const filePath = path.join(dir, fileName);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(targetPath, filePath);
  const manifest = {
    version: 1,
    kind: 'project',
    projectPath,
    entryPath: targetPath,
    fileName,
    action,
    existed: true,
    originalHash: sha256(fs.readFileSync(filePath)),
    backedUpAt: formatLocalIso(now)
  };
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  return {
    dir,
    relativeDir: path.relative(repoRoot, dir).replace(/\\/g, '/'),
    filePath,
    originalHash: manifest.originalHash
  };
}

function uniqueDir(baseDir, stamp) {
  let candidate = path.join(baseDir, stamp);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(baseDir, `${stamp}-${index}`);
    index += 1;
  }
  return candidate;
}

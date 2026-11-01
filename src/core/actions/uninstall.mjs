import fs from 'node:fs';
import path from 'node:path';
import { createBackup, restoreBackup } from '../lib/backup.mjs';
import { decodeText, encodeText } from '../lib/encoding.mjs';
import { atomicWriteFile } from '../lib/fs-safe.mjs';
import { planGlobalWorkbench } from '../lib/global-workbench.mjs';
import { sha256 } from '../lib/hash.mjs';
import { acquireLock } from '../lib/lock.mjs';
import { loadMachine } from '../lib/machine.mjs';
import { findBlock, removeBlock } from '../lib/merge-engine.mjs';
import { resolvePath } from '../lib/paths.mjs';
import { listSkills } from '../lib/skills-index.mjs';
import { readState, writeState } from '../lib/state.mjs';
import { loadTargets } from '../lib/target-registry.mjs';

/**
 * 预演或执行卸载：移除入口中的工作台块或工作台创建的文件，并清理技能与全局脚本 junction。
 * 默认只预演，--apply 才写入；备份与全局工作台目录保留。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{tool?: string, apply?: boolean, dryRun?: boolean, force?: boolean}} [params] 动作参数
 * @returns {Promise<object>} 卸载结果
 */
export async function run(ctx, params = {}) {
  if (params.apply && params.dryRun) {
    throw new Error('--apply 与 --dry-run 不能同时使用');
  }

  const apply = params.apply === true;
  const force = params.force === true;
  const tools = loadTargets(ctx.repoRoot, { hostname: ctx.hostname });
  const selected = selectTools(tools, params.tool);
  const state = readState(ctx.repoRoot);

  const targets = selected.map((tool) => planEntry(tool, state.targets[tool.id] ?? null, force));
  const skills = planSkillsRemoval(ctx.repoRoot, selected);
  const global = params.tool ? null : planGlobalRemoval(ctx);

  const result = {
    dryRun: !apply,
    applied: false,
    scope: { tool: params.tool ?? null, force },
    targets,
    skills,
    global,
    summary: summarize(targets, skills, global),
    apply: null
  };

  if (!apply) return result;

  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const lock = acquireLock(ctx.repoRoot, { now });

  try {
    const lockedState = readState(ctx.repoRoot);
    const lockedTargets = selected.map((tool) =>
      planEntry(tool, lockedState.targets[tool.id] ?? null, force)
    );
    const lockedSkills = planSkillsRemoval(ctx.repoRoot, selected);
    const lockedGlobal = params.tool ? null : planGlobalRemoval(ctx);
    if (
      fingerprint(targets, skills, global) !==
      fingerprint(lockedTargets, lockedSkills, lockedGlobal)
    ) {
      throw new Error('入口或技能链接在预演后发生变化，未卸载。请重新运行 uninstall 确认。');
    }

    const applied = applyPlans(ctx, {
      state: lockedState,
      targets: lockedTargets,
      skills: lockedSkills,
      global: lockedGlobal,
      now
    });

    return {
      ...result,
      dryRun: false,
      applied: applied.ok,
      targets: lockedTargets,
      skills: applied.skills,
      global: applied.global,
      summary: summarize(lockedTargets, applied.skills, applied.global),
      apply: applied.apply
    };
  } finally {
    lock.release();
  }
}

function selectTools(tools, toolId) {
  if (!toolId) return tools;
  const selected = tools.filter((tool) => tool.id === toolId);
  if (selected.length === 0) {
    throw new Error(
      `未知目标：${toolId}。可选：${tools.map((tool) => tool.id).join(', ')}`
    );
  }
  return selected;
}

function planEntry(tool, stored, force) {
  const entryPath =
    stored?.entryPath && fs.existsSync(stored.entryPath) ? stored.entryPath : tool.entryPath;
  const base = {
    id: tool.id,
    name: tool.name,
    entryPath,
    storedEntryPath: stored?.entryPath ?? null,
    currentHash: null,
    storedHash: stored?.fileHash ?? null,
    blockHash: null,
    storedBlockHash: stored?.blockHash ?? null,
    canForce: false,
    applyStatus: null,
    backup: null
  };

  if (!fs.existsSync(entryPath)) {
    return { ...base, status: 'absent', reason: '入口文件不存在' };
  }

  let buffer;
  try {
    buffer = fs.readFileSync(entryPath);
  } catch (error) {
    return { ...base, status: 'blocked', reason: `入口文件无法读取：${error.message}` };
  }

  const currentHash = sha256(buffer);
  const decoded = decodeText(buffer);
  if (decoded.text === null) {
    return {
      ...base,
      currentHash,
      status: 'blocked',
      reason: `入口不是可写文本（检测为 ${decoded.encoding}），需人工处理`
    };
  }

  const found = findBlock(decoded.text);
  if (found.status === 'absent') {
    return { ...base, currentHash, status: 'absent', reason: '入口中没有工作台块' };
  }
  if (found.status === 'malformed') {
    return { ...base, currentHash, status: 'blocked', reason: found.reason };
  }

  const withHashes = { ...base, currentHash, blockHash: found.blockHash };

  if (!stored) {
    if (!force) {
      return {
        ...withHashes,
        status: 'blocked',
        canForce: true,
        reason: '发现工作台块但没有部署记录，确认移除时加 --force'
      };
    }
    return {
      ...withHashes,
      status: 'remove-block',
      reason: '没有部署记录，将按 --force 移除工作台块并保留文件'
    };
  }

  if (found.blockHash !== stored.blockHash) {
    if (!force) {
      return {
        ...withHashes,
        status: 'blocked',
        canForce: true,
        reason: '工作台块与部署记录不一致，确认移除时加 --force'
      };
    }
    return {
      ...withHashes,
      status: 'remove-block',
      reason: '工作台块与部署记录不一致，将按 --force 移除并保留文件'
    };
  }

  if (stored.action === 'create-file' && stored.fileHash === currentHash) {
    return {
      ...withHashes,
      status: 'delete-file',
      reason: '入口由工作台创建且部署后未修改，将删除整个文件'
    };
  }

  return {
    ...withHashes,
    status: 'remove-block',
    reason:
      stored.fileHash === currentHash
        ? '将移除入口中的工作台块，保留文件其余内容'
        : '入口在部署后另有修改，仅移除工作台块并保留其余内容'
  };
}

function planSkillsRemoval(repoRoot, tools) {
  const skills = listSkills(repoRoot).map((skill) => ({ name: skill.name, dir: skill.dir }));
  const toolPlans = tools.map((tool) => planToolSkills(tool, skills));
  const links = toolPlans.flatMap((tool) => tool.links);
  const toolConflicts = toolPlans.filter((tool) => tool.action === 'conflict').length;

  return {
    sourceDir: path.join(repoRoot, 'content', 'skills'),
    skills: skills.map((skill) => skill.name),
    tools: toolPlans,
    summary: {
      remove: links.filter((link) => link.action === 'remove-junction').length,
      removed: 0,
      conflict: links.filter((link) => link.action === 'conflict').length + toolConflicts,
      absent: links.filter((link) => link.action === 'absent').length,
      failed: 0
    },
    ok: toolConflicts === 0 && links.every((link) => link.action !== 'conflict'),
    applied: false
  };
}

function planToolSkills(tool, skills) {
  const base = {
    id: tool.id,
    name: tool.name,
    skillsDir: tool.skillsDir,
    links: [],
    applyStatus: null
  };

  if (!tool.skillsDir) {
    return { ...base, action: 'no-skills-dir', reason: '未登记技能目录' };
  }

  let stat;
  try {
    stat = fs.statSync(tool.skillsDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ...base, action: 'absent', reason: '技能目录不存在' };
    }
    return { ...base, action: 'conflict', reason: `技能目录无法访问：${error.message}` };
  }

  if (!stat.isDirectory()) {
    return { ...base, action: 'conflict', reason: '技能目录路径已存在但不是目录' };
  }

  const links = skills.map((skill) => planLinkRemoval(tool.skillsDir, skill));
  return { ...base, action: 'ready', reason: '技能目录已存在', links };
}

function planLinkRemoval(skillsDir, skill) {
  const linkPath = path.join(skillsDir, skill.name);
  const base = { skill: skill.name, path: linkPath, target: skill.dir, currentTarget: null };

  let stat;
  try {
    stat = fs.lstatSync(linkPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ...base, action: 'absent', reason: '链接不存在' };
    }
    return { ...base, action: 'conflict', reason: `链接无法访问：${error.message}` };
  }

  if (!stat.isSymbolicLink()) {
    return {
      ...base,
      action: 'conflict',
      reason: '同名路径不是 junction，可能是用户自建技能，将保留'
    };
  }

  let currentTarget;
  try {
    currentTarget = fs.realpathSync(linkPath);
  } catch (error) {
    return { ...base, action: 'conflict', reason: `链接无法解析：${error.message}` };
  }

  if (samePath(currentTarget, skill.dir)) {
    return { ...base, currentTarget, action: 'remove-junction', reason: '将移除指向本仓库的 junction' };
  }
  return {
    ...base,
    currentTarget,
    action: 'conflict',
    reason: `链接指向其他位置，将保留：${currentTarget}`
  };
}

function planGlobalRemoval(ctx) {
  let machine;
  try {
    machine = loadMachine(ctx.repoRoot, ctx.hostname);
  } catch (error) {
    return { status: 'unconfigured', reason: `无法读取机器档案：${error.message}` };
  }

  const configuredPath = machine.paths['全局工作台'];
  if (!configuredPath) {
    return { status: 'unconfigured', reason: '机器档案缺少“全局工作台”' };
  }

  const plan = planGlobalWorkbench(ctx.repoRoot, resolvePath(configuredPath));
  const link = plan.link;
  const base = {
    globalRoot: plan.globalRoot,
    path: link.path,
    target: link.target,
    currentTarget: link.currentTarget,
    applyStatus: null
  };

  if (link.action === 'unchanged') {
    return {
      ...base,
      status: 'remove-junction',
      reason: '将移除指向本仓库的脚本 junction，保留全局工作台目录与用户数据'
    };
  }
  if (link.action === 'create-junction') {
    return { ...base, status: 'absent', reason: '脚本 junction 不存在' };
  }
  return { ...base, status: 'conflict', reason: link.reason };
}

function applyPlans(ctx, { state, targets, skills, global, now }) {
  let failure = null;
  let stateChanged = false;

  for (const target of targets) {
    if (failure) {
      target.applyStatus = 'aborted';
      continue;
    }

    if (target.status === 'blocked') {
      target.applyStatus = 'blocked';
      continue;
    }

    if (target.status === 'absent') {
      target.applyStatus = 'absent';
      if (state.targets[target.id]) {
        delete state.targets[target.id];
        stateChanged = true;
      }
      continue;
    }

    try {
      applyEntryRemoval(ctx.repoRoot, target, now);
      delete state.targets[target.id];
      stateChanged = true;
    } catch (error) {
      failure = {
        id: target.id,
        name: target.name,
        entryPath: target.entryPath,
        error: error.message
      };
      target.applyStatus = 'failed';
    }
  }

  if (stateChanged) writeState(ctx.repoRoot, state);

  const skillsResult = failure ? abortSkills(skills) : applySkillsRemoval(skills);
  const globalResult = global
    ? failure
      ? { ...global, applyStatus: 'aborted' }
      : applyGlobalRemoval(global)
    : null;

  const failed =
    (failure ? 1 : 0) +
    skillsResult.summary.failed +
    (globalResult?.applyStatus === 'failed' ? 1 : 0);

  return {
    ok: !failure && failed === 0 && targets.every((target) => target.applyStatus !== 'blocked'),
    skills: skillsResult,
    global: globalResult,
    apply: {
      ok: !failure && failed === 0 && targets.every((target) => target.applyStatus !== 'blocked'),
      deleted: targets.filter((target) => target.applyStatus === 'deleted').length,
      removedBlocks: targets.filter((target) => target.applyStatus === 'removed-block').length,
      absent: targets.filter((target) => target.applyStatus === 'absent').length,
      blocked: targets.filter((target) => target.applyStatus === 'blocked').length,
      skillsRemoved: skillsResult.summary.removed,
      globalRemoved: globalResult?.applyStatus === 'removed' ? 1 : 0,
      failed,
      failure,
      reason: failure
        ? `卸载 ${failure.name} 失败，已停止后续入口；已成功的卸载与状态记录保留。`
        : targets.some((target) => target.applyStatus === 'blocked')
          ? '部分入口未卸载，需要人工确认后加 --force 重试。'
          : null
    }
  };
}

function applyEntryRemoval(repoRoot, target, now) {
  const currentHash = sha256(fs.readFileSync(target.entryPath));
  if (currentHash !== target.currentHash) {
    throw new Error('入口在预演后发生变化，未卸载');
  }

  const backup = createBackup(repoRoot, {
    toolId: target.id,
    entryPath: target.entryPath,
    action: 'uninstall-safety',
    now
  });

  try {
    if (target.status === 'delete-file') {
      fs.unlinkSync(target.entryPath);
      if (fs.existsSync(target.entryPath)) throw new Error('文件删除后仍然存在');
    } else {
      const decoded = decodeText(fs.readFileSync(target.entryPath));
      if (decoded.text === null) {
        throw new Error(`入口无法解码为文本（检测为 ${decoded.encoding}）`);
      }
      const nextText = removeBlock(decoded.text);
      const buffer = encodeText(nextText, {
        encoding: decoded.encoding,
        hasBom: decoded.hasBom
      });
      atomicWriteFile(target.entryPath, buffer);
      verifyBlockRemoved(target.entryPath, buffer);
    }
    target.backup = backup.relativeDir;
    target.applyStatus = target.status === 'delete-file' ? 'deleted' : 'removed-block';
  } catch (error) {
    let rollbackNote;
    try {
      restoreBackup(backup, target.entryPath);
      rollbackNote = '已从备份恢复原文件';
    } catch (rollbackError) {
      rollbackNote = `回滚失败，请按备份手工恢复（${rollbackError.message}）`;
    }
    throw new Error(`卸载 ${target.entryPath} 失败，${rollbackNote}：${error.message}`);
  }
}

function verifyBlockRemoved(entryPath, expectedBuffer) {
  const written = fs.readFileSync(entryPath);
  if (sha256(written) !== sha256(expectedBuffer)) {
    throw new Error('写后字节校验不一致');
  }

  const decoded = decodeText(written);
  if (decoded.text === null) {
    throw new Error(`写后文件无法解码为文本（检测为 ${decoded.encoding}）`);
  }
  if (findBlock(decoded.text).status !== 'absent') {
    throw new Error('写后仍能匹配到工作台块');
  }
}

function applySkillsRemoval(plan) {
  const result = {
    ...plan,
    tools: plan.tools.map((tool) => ({
      ...tool,
      links: tool.links.map((link) => ({ ...link }))
    })),
    applied: true
  };

  let removed = 0;
  let failed = 0;
  for (const tool of result.tools) {
    let toolFailed = 0;
    let toolRemoved = 0;
    for (const link of tool.links) {
      if (link.action !== 'remove-junction') {
        link.applyStatus = 'skipped';
        continue;
      }
      try {
        assertLinkStillPointsTo(link);
        fs.unlinkSync(link.path);
        link.applyStatus = 'removed';
        toolRemoved += 1;
        removed += 1;
      } catch (error) {
        link.applyStatus = 'failed';
        link.error = error.message;
        toolFailed += 1;
        failed += 1;
      }
    }

    if (toolFailed > 0) tool.applyStatus = 'failed';
    else if (toolRemoved > 0) tool.applyStatus = 'removed';
    else tool.applyStatus = 'skipped';
  }

  result.summary = {
    ...result.summary,
    removed,
    failed
  };
  result.ok = plan.ok && failed === 0;
  return result;
}

function assertLinkStillPointsTo(link) {
  const stat = fs.lstatSync(link.path);
  if (!stat.isSymbolicLink()) throw new Error('同名路径已不是 junction');
  if (!samePath(fs.realpathSync(link.path), link.target)) {
    throw new Error('链接指向已变化，未移除');
  }
}

function applyGlobalRemoval(global) {
  if (global.status !== 'remove-junction') {
    return { ...global, applyStatus: 'skipped' };
  }

  try {
    assertLinkStillPointsTo(global);
    fs.unlinkSync(global.path);
    return { ...global, applyStatus: 'removed' };
  } catch (error) {
    return { ...global, applyStatus: 'failed', error: error.message };
  }
}

function abortSkills(plan) {
  return {
    ...plan,
    applied: false,
    aborted: true,
    tools: plan.tools.map((tool) => ({
      ...tool,
      applyStatus: tool.action === 'ready' ? 'aborted' : 'skipped',
      links: tool.links.map((link) => ({
        ...link,
        applyStatus: link.action === 'remove-junction' ? 'aborted' : 'skipped'
      }))
    }))
  };
}

function summarize(targets, skills, global) {
  const count = (status) => targets.filter((target) => target.status === status).length;
  const applyCount = (status) =>
    targets.filter((target) => target.applyStatus === status).length;

  return {
    total: targets.length,
    deleteFile: count('delete-file'),
    removeBlock: count('remove-block'),
    absent: count('absent'),
    blocked: count('blocked'),
    deleted: applyCount('deleted'),
    blocksRemoved: applyCount('removed-block'),
    failed: applyCount('failed'),
    skillsRemove: skills.summary.remove,
    skillsRemoved: skills.summary.removed,
    skillsConflict: skills.summary.conflict,
    skillsFailed: skills.summary.failed,
    globalRemove: global?.status === 'remove-junction' ? 1 : 0,
    globalRemoved: global?.applyStatus === 'removed' ? 1 : 0
  };
}

function fingerprint(targets, skills, global) {
  return JSON.stringify({
    targets: targets.map((target) => [
      target.id,
      target.entryPath,
      target.status,
      target.currentHash,
      target.storedHash,
      target.blockHash,
      target.storedBlockHash
    ]),
    skills: skills.tools.map((tool) => [
      tool.id,
      tool.action,
      tool.links.map((link) => [link.skill, link.action, link.currentTarget])
    ]),
    global: global
      ? [global.status, global.path, global.currentTarget, global.target]
      : null
  });
}

function samePath(left, right) {
  const normalize = (value) => path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
  return normalize(left) === normalize(right);
}

import fs from 'node:fs';
import path from 'node:path';
import { memorySpec } from './memory-block.mjs';
import { expandPath } from './paths.mjs';
import { buildSettingsEnv, loadSettings } from './settings.mjs';
import {
  checkToolVersion,
  detectToolVersion,
  normalizeVersionSpec
} from './tool-version.mjs';

const VALID_STATUS = new Set(['verified', 'documented', 'unverified', 'unsupported']);
const VALID_STRATEGY = new Set(['block-append', 'separate-file', 'memory-block']);
const VALID_CUSTOM_STRATEGY = new Set(['block-append', 'separate-file']);
const VALID_FORMAT = new Set(['markdown', 'mdc']);
const VALID_MEMORY_PLACEMENT = new Set(['top', 'bottom']);
const ACCOUNT_SNAPSHOT_MAX_SIZE = 4096;
const ACCOUNT_SNAPSHOT_MAX_STALENESS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 读取并校验工具目标注册表，应用机器档案中的路径覆盖与环境变量，同时解析安装状态。
 * @param {string} repoRoot 仓库根目录
 * @param {{hostname?: string, now?: number|Date}} [options] 选项
 * @returns {Array<Record<string, unknown>>} 目标列表
 */
export function loadTargets(repoRoot, options = {}) {
  const { registry, registryPath } = readRegistry(repoRoot);

  const settings = loadSettings(repoRoot, options.hostname);
  const customIssues = settings.issues.filter(
    (issue) => issue.key === 'customTools' || issue.key.startsWith('customTools.')
  );
  if (customIssues.length > 0) {
    throw new Error(
      `自定义工具设置存在问题，请先在设置页修复：${customIssues
        .map((issue) => `${issue.key}：${issue.message}`)
        .join('；')}`
    );
  }

  const env = buildSettingsEnv(settings.settings.env);
  const overrides = settings.settings.tools;
  const ids = new Set();

  const builtIn = registry.tools.map((tool) => {
    validateTool(tool, registryPath);
    if (ids.has(tool.id)) {
      throw new Error(`目标注册表存在重复 id：${tool.id}`);
    }
    ids.add(tool.id);

    try {
      return resolveTool(tool, overrides[tool.id] ?? {}, env, repoRoot, options);
    } catch (error) {
      throw new Error(`工具 ${tool.id} 的覆盖无效：${error.message}`);
    }
  });

  const custom = Object.entries(settings.settings.customTools ?? {}).map(([toolId, tool]) => {
    if (ids.has(toolId)) {
      throw new Error(
        `自定义工具 id 与内置目标重复：${toolId}。请在设置页改用其他 id，避免部署目标混淆。`
      );
    }
    ids.add(toolId);
    try {
      return resolveCustomTool(toolId, tool, env);
    } catch (error) {
      throw new Error(`自定义工具 ${toolId} 无效：${error.message}`);
    }
  });

  return [...builtIn, ...custom];
}

/**
 * 只读取目标 id，不展开路径；用于设置校验等不需要安装状态的场景。
 * @param {string} repoRoot 仓库根目录
 * @returns {string[]} 工具 id
 */
export function listTargetIds(repoRoot) {
  return readRegistry(repoRoot).registry.tools.map((tool) => tool.id);
}

function readRegistry(repoRoot) {
  const registryPath = path.join(repoRoot, 'adapters', 'targets.json');
  if (!fs.existsSync(registryPath)) {
    throw new Error(`缺少目标注册表：${registryPath}`);
  }

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    throw new Error(`目标注册表无法解析：${registryPath}（${error.message}）`);
  }

  if (!Array.isArray(registry.tools)) {
    throw new Error(`目标注册表缺少 tools 数组：${registryPath}`);
  }

  return { registry, registryPath };
}

function resolveTool(tool, override, env, repoRoot, options = {}) {
  const baseConfigRoot = expandPath(tool.configRoot, env);
  const baseEntryPath = expandPath(tool.entry.path, env);
  const baseAlternativePaths = (tool.entry.alternatives ?? []).map((item) => expandPath(item, env));
  const baseSkillsDir = tool.skillsDir ? expandPath(tool.skillsDir, env) : null;

  const hasEntryOverride = typeof override.entryPath === 'string';
  const configRoot = expandPath(override.configRoot ?? tool.configRoot, env);
  const configuredEntryPath = expandPath(override.entryPath ?? tool.entry.path, env);
  let primaryEntryPath = configuredEntryPath;
  let entryPathSource = hasEntryOverride ? 'override' : 'default';
  let entryPathProblem = null;
  let entryPathBlocked = false;
  let alternativePaths = hasEntryOverride ? [] : baseAlternativePaths;

  if (!hasEntryOverride && tool.entry.accountDir) {
    const account = resolveAccountEntry(
      { fallbackPath: primaryEntryPath, accountDir: tool.entry.accountDir },
      configRoot,
      { now: options.now }
    );
    primaryEntryPath = account.path;
    entryPathSource = account.source;
    entryPathProblem = account.problem;
    entryPathBlocked = account.source === 'device-root';
    if (entryPathBlocked) {
      const cause = entryPathProblem ? `${entryPathProblem}；` : '';
      const suspicion = account.accountDirExists
        ? '配置根下已存在账号记忆目录，疑似 WorkBuddy 已登出'
        : '未检测到已登录的 WorkBuddy 账号';
      entryPathProblem = `${cause}${suspicion}。设备根记忆只在未登录时可能被读取，登录后注入走账号目录，写入设备根会写错位置；部署已阻止：请先启动 WorkBuddy 登录后重新预演，或确认要固定入口时用 tools.workbuddy.entryPath 显式覆盖。`;
    }
    if (account.source === 'account') alternativePaths = [];
  }

  const candidates = [primaryEntryPath, ...alternativePaths];
  const existingPath = candidates.find((candidate) => fs.existsSync(candidate));
  const entryPath = existingPath ?? primaryEntryPath;
  if (existingPath && existingPath !== primaryEntryPath) entryPathSource = 'alternative';
  const memory = tool.entry.strategy === 'memory-block' ? memorySpec(tool.entry) : null;
  const splitFilePath = memory ? path.resolve(configRoot, tool.entry.splitFile) : null;
  if (
    splitFilePath &&
    (samePath(splitFilePath, entryPath) || samePath(splitFilePath, configuredEntryPath))
  ) {
    throw new Error('memory-block 的 splitFile 不能与 entry.path 相同');
  }
  const skillsDir = override.skillsDir
    ? expandPath(override.skillsDir, env)
    : baseSkillsDir;
  const enabled =
    typeof override.enabled === 'boolean' ? override.enabled : tool.enabled !== false;
  const version = normalizeVersionSpec(override.version ?? null)?.value ?? null;
  const detected = detectToolVersion(
    {
      versionProbe: tool.versionProbe ?? null,
      custom: false,
      configRoot,
      id: tool.id
    },
    env
  );
  const versionCheck = checkToolVersion({
    version,
    detectedVersion: detected.detected,
    versionDetail: detected.detail,
    versionSource: detected.source,
    versionProblem: detected.problem
  });

  return {
    ...tool,
    configRoot,
    version,
    detectedVersion: detected.detected,
    versionDetail: detected.detail,
    versionSource: detected.source,
    versionProblem: detected.problem,
    versionCheck,
    entry: {
      ...tool.entry,
      markers: memory?.markers ?? null,
      budget: memory?.budget ?? null,
      placement: memory?.placement ?? null,
      splitFilePath
    },
    entryPrimaryPath: primaryEntryPath,
    entryAlternatives: alternativePaths,
    entryPath,
    entryPathSource,
    entryPathProblem,
    entryPathBlocked,
    entryExists: Boolean(existingPath),
    usingFallback: Boolean(existingPath && existingPath !== primaryEntryPath),
    enabled,
    installed: enabled && fs.existsSync(configRoot),
    configRootExists: fs.existsSync(configRoot),
    skillsDir,
    skillsDirExists: Boolean(skillsDir && fs.existsSync(skillsDir)),
    custom: false,
    frontmatterTemplate: tool.entry.frontmatterTemplate
      ? path.join(repoRoot, tool.entry.frontmatterTemplate)
      : null,
    base: {
      configRoot: baseConfigRoot,
      entryPath: baseEntryPath,
      entryAlternatives: baseAlternativePaths,
      skillsDir: baseSkillsDir
    },
    overrides: {
      enabled: typeof override.enabled === 'boolean' ? override.enabled : null,
      version: override.version ?? null,
      configRoot: override.configRoot ?? null,
      entryPath: override.entryPath ?? null,
      skillsDir: override.skillsDir ?? null
    }
  };
}

/**
 * 按账号快照解析账号级记忆路径；快照缺失、非法或过期时回落到设备根。
 * 规则与 WorkBuddy 一致：快照不超过 4096 字节、结构合法且保存时间在 30 天内。
 * 回落时检查配置根下是否已存在账号记忆目录：存在说明此前绑定过账号（现已登出），
 * 返回 accountDirExists=true 供调用方区分提示文案；无论哪种回落，部署都应阻止。
 * @param {{fallbackPath: string, accountDir: {snapshot: string, path: string}}} spec 入口配置
 * @param {string} configRoot 配置根目录
 * @param {{now?: number|Date}} [options] 选项
 * @returns {{path: string, source: 'account'|'device-root'|'default', problem: string|null, accountDirExists: boolean}}
 */
export function resolveAccountEntry({ fallbackPath, accountDir }, configRoot, options = {}) {
  if (!accountDir) {
    return { path: fallbackPath, source: 'default', problem: null, accountDirExists: false };
  }

  const snapshotPath = path.resolve(configRoot, accountDir.snapshot);
  const fallback = (problem) => ({
    path: fallbackPath,
    source: 'device-root',
    problem,
    accountDirExists: hasAccountDirEvidence(configRoot, accountDir)
  });

  let buffer;
  try {
    buffer = fs.readFileSync(snapshotPath);
  } catch (error) {
    return fallback(error.code === 'ENOENT' ? null : `账号快照无法读取：${error.message}`);
  }

  if (buffer.length > ACCOUNT_SNAPSHOT_MAX_SIZE) {
    return fallback(`账号快照超过 ${ACCOUNT_SNAPSHOT_MAX_SIZE} 字节，WorkBuddy 会视为无效`);
  }

  let snapshot;
  try {
    snapshot = JSON.parse(buffer.toString('utf8'))?.primary;
  } catch {
    return fallback('账号快照不是有效 JSON，WorkBuddy 会视为无效');
  }

  if (!isAccountSnapshot(snapshot)) {
    return fallback('账号快照结构不符合 WorkBuddy 要求，会被视为无效');
  }

  const now = options.now instanceof Date ? options.now.getTime() : options.now ?? Date.now();
  if (now - snapshot.savedAt > ACCOUNT_SNAPSHOT_MAX_STALENESS_MS) {
    return fallback(
      '账号快照已超过 30 天，WorkBuddy 会视为未绑定；请先启动 WorkBuddy 刷新登录后再部署'
    );
  }

  const uid = snapshot.uid.trim();
  const scope =
    typeof snapshot.enterpriseId === 'string' && snapshot.enterpriseId.trim() !== ''
      ? snapshot.enterpriseId.trim()
      : 'personal';
  if (!isSafeAccountSegment(uid) || !isSafeAccountSegment(scope)) {
    return fallback('账号快照中的用户或企业标识不能作为目录名，已回落到设备根');
  }

  const relative = accountDir.path.replaceAll('{uid}', uid).replaceAll('{scope}', scope);
  const resolved = path.resolve(configRoot, relative);
  if (!isInsideDirectory(configRoot, resolved)) {
    return fallback('账号记忆路径不在配置目录内，已回落到设备根');
  }

  return { path: resolved, source: 'account', problem: null, accountDirExists: true };
}

function hasAccountDirEvidence(configRoot, accountDir) {
  let entries;
  try {
    entries = fs.readdirSync(configRoot, { withFileTypes: true });
  } catch {
    return false;
  }
  const segment = accountDir.path.split(/[\\/]/)[0];
  const pattern = segment
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('\\{uid\\}', '[^\\\\/]+')
    .replaceAll('\\{scope\\}', '[^\\\\/]+');
  const regex = new RegExp(`^${pattern}$`);
  return entries.some((item) => item.isDirectory() && regex.test(item.name));
}

function isAccountSnapshot(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.version === 1 &&
      typeof value.uid === 'string' &&
      value.uid.length > 0 &&
      typeof value.nickname === 'string' &&
      typeof value.type === 'string' &&
      typeof value.savedAt === 'number' &&
      Number.isFinite(value.savedAt)
  );
}

function isSafeAccountSegment(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    value !== '.' &&
    value !== '..' &&
    !/[\\/:*?"<>|\0-\x1f]/.test(value) &&
    !/[. ]$/.test(value)
  );
}

function isInsideDirectory(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveCustomTool(toolId, tool, env) {
  const missing = ['name', 'configRoot', 'entryPath'].filter(
    (field) => typeof tool[field] !== 'string' || tool[field].trim() === ''
  );
  if (missing.length > 0) {
    throw new Error(`缺少必填项：${missing.join('、')}`);
  }

  const configRoot = expandPath(tool.configRoot, env);
  const entryPath = expandPath(tool.entryPath, env);
  const skillsDir = tool.skillsDir ? expandPath(tool.skillsDir, env) : null;
  for (const [field, value] of [
    ['configRoot', configRoot],
    ['entryPath', entryPath],
    ['skillsDir', skillsDir]
  ]) {
    if (value !== null && !path.isAbsolute(value)) {
      throw new Error(`${field} 必须是绝对路径或以 ~ 开头的本机路径：${value}`);
    }
  }

  const strategy = tool.strategy ?? 'block-append';
  const format = tool.format ?? 'markdown';
  if (!VALID_CUSTOM_STRATEGY.has(strategy)) {
    throw new Error(`strategy 无效：${strategy}`);
  }
  if (!VALID_FORMAT.has(format)) {
    throw new Error(`format 无效：${format}`);
  }

  const enabled = tool.enabled !== false;
  const version = normalizeVersionSpec(tool.version ?? null)?.value ?? null;
  const detected = detectToolVersion(
    {
      versionProbe: null,
      custom: true,
      configRoot,
      id: toolId
    },
    env
  );
  const versionCheck = checkToolVersion({
    version,
    detectedVersion: detected.detected,
    versionDetail: detected.detail,
    versionSource: detected.source,
    versionProblem: detected.problem
  });

  return {
    id: toolId,
    name: tool.name,
    configRoot,
    version,
    detectedVersion: detected.detected,
    versionDetail: detected.detail,
    versionSource: detected.source,
    versionProblem: detected.problem,
    versionCheck,
    entry: {
      path: entryPath,
      alternatives: [],
      format,
      strategy,
      markers: null,
      budget: null,
      placement: null,
      splitFilePath: null
    },
    frontmatter: typeof tool.frontmatter === 'string' ? tool.frontmatter : '',
    entryPrimaryPath: entryPath,
    entryAlternatives: [],
    entryPath,
    entryPathSource: 'default',
    entryPathProblem: null,
    entryPathBlocked: false,
    entryExists: fs.existsSync(entryPath),
    usingFallback: false,
    enabled,
    installed: enabled && fs.existsSync(configRoot),
    configRootExists: fs.existsSync(configRoot),
    skillsDir,
    skillsDirExists: Boolean(skillsDir && fs.existsSync(skillsDir)),
    skillsStatus: 'custom',
    status: 'unverified',
    notes: '本机自定义工具，由设置页维护',
    custom: true,
    frontmatterTemplate: null,
    base: {
      configRoot,
      entryPath,
      entryAlternatives: [],
      skillsDir
    },
    overrides: {
      enabled: null,
      version: null,
      configRoot: null,
      entryPath: null,
      skillsDir: null
    }
  };
}

function validateTool(tool, registryPath) {
  const prefix = `目标注册表 ${registryPath}`;
  if (!tool || typeof tool !== 'object') throw new Error(`${prefix} 存在无效工具项`);
  if (!tool.id) throw new Error(`${prefix} 存在缺少 id 的工具`);
  if (!tool.name) throw new Error(`${prefix} 中 ${tool.id} 缺少 name`);
  if (!tool.configRoot) throw new Error(`${prefix} 中 ${tool.id} 缺少 configRoot`);
  if (!tool.entry?.path) throw new Error(`${prefix} 中 ${tool.id} 缺少 entry.path`);
  if (!VALID_STRATEGY.has(tool.entry.strategy)) {
    throw new Error(`${prefix} 中 ${tool.id} 的 entry.strategy 无效：${tool.entry.strategy}`);
  }
  if (!VALID_FORMAT.has(tool.entry.format)) {
    throw new Error(`${prefix} 中 ${tool.id} 的 entry.format 无效：${tool.entry.format}`);
  }
  if (tool.entry.strategy === 'memory-block') {
    validateMemoryEntry(tool.entry, prefix, tool.id);
  } else if (tool.entry.accountDir !== undefined) {
    throw new Error(`${prefix} 中 ${tool.id} 的 entry.accountDir 只支持 memory-block`);
  }
  if (!VALID_STATUS.has(tool.status)) {
    throw new Error(`${prefix} 中 ${tool.id} 的 status 无效：${tool.status}`);
  }
  if (tool.enabled !== undefined && typeof tool.enabled !== 'boolean') {
    throw new Error(`${prefix} 中 ${tool.id} 的 enabled 必须是布尔值`);
  }
  if (tool.version !== undefined) {
    try {
      normalizeVersionSpec(tool.version);
    } catch (error) {
      throw new Error(`${prefix} 中 ${tool.id} 的 version 无效：${error.message}`);
    }
  }
  if (tool.versionProbe !== undefined) {
    const probe = tool.versionProbe;
    if (!probe || typeof probe !== 'object' || Array.isArray(probe)) {
      throw new Error(`${prefix} 中 ${tool.id} 的 versionProbe 必须是对象`);
    }
    if (
      !Array.isArray(probe.paths) ||
      probe.paths.length === 0 ||
      probe.paths.some((item) => typeof item !== 'string' || item.trim() === '')
    ) {
      throw new Error(`${prefix} 中 ${tool.id} 的 versionProbe.paths 必须是非空字符串数组`);
    }
    if (typeof probe.field !== 'string' || probe.field.trim() === '') {
      throw new Error(`${prefix} 中 ${tool.id} 的 versionProbe.field 必须是非空字符串`);
    }
    for (const field of ['label', 'detailField']) {
      if (
        probe[field] !== undefined &&
        (typeof probe[field] !== 'string' || probe[field].trim() === '')
      ) {
        throw new Error(`${prefix} 中 ${tool.id} 的 versionProbe.${field} 必须是非空字符串`);
      }
    }
  }
}

function validateMemoryEntry(entry, prefix, toolId) {
  const label = `${prefix} 中 ${toolId} 的 entry`;
  if (entry.placement !== undefined && !VALID_MEMORY_PLACEMENT.has(entry.placement)) {
    throw new Error(`${label}.placement 只能是 top 或 bottom：${entry.placement}`);
  }
  if (typeof entry.splitFile !== 'string' || entry.splitFile.trim() === '') {
    throw new Error(`${label}.splitFile 必须是非空相对路径`);
  }
  if (
    path.isAbsolute(entry.splitFile) ||
    /^[A-Za-z]:/.test(entry.splitFile) ||
    /^[\\/]{2}/.test(entry.splitFile)
  ) {
    throw new Error(`${label}.splitFile 必须是相对配置根的路径：${entry.splitFile}`);
  }
  if (entry.splitFile.split(/[\\/]+/).includes('..')) {
    throw new Error(`${label}.splitFile 不能包含 ..：${entry.splitFile}`);
  }
  if (entry.accountDir !== undefined) {
    validateAccountDir(entry.accountDir, label);
  }
  for (const field of ['markers', 'budget']) {
    if (
      entry[field] !== undefined &&
      (entry[field] === null || typeof entry[field] !== 'object' || Array.isArray(entry[field]))
    ) {
      throw new Error(`${label}.${field} 必须是对象`);
    }
  }
  try {
    memorySpec(entry);
  } catch (error) {
    throw new Error(`${label} 的 memory-block 配置无效：${error.message}`);
  }
}

function validateAccountDir(accountDir, label) {
  const fieldLabel = `${label}.accountDir`;
  if (!accountDir || typeof accountDir !== 'object' || Array.isArray(accountDir)) {
    throw new Error(`${fieldLabel} 必须是对象`);
  }
  for (const field of ['snapshot', 'path']) {
    const value = accountDir[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${fieldLabel}.${field} 必须是非空相对路径`);
    }
    if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || /^[\\/]{2}/.test(value)) {
      throw new Error(`${fieldLabel}.${field} 必须是相对配置根的路径：${value}`);
    }
    if (value.split(/[\\/]+/).includes('..')) {
      throw new Error(`${fieldLabel}.${field} 不能包含 ..：${value}`);
    }
  }
  if (!accountDir.path.includes('{uid}')) {
    throw new Error(`${fieldLabel}.path 必须包含 {uid} 占位符：${accountDir.path}`);
  }
  const stripped = accountDir.path.replaceAll('{uid}', '').replaceAll('{scope}', '');
  if (stripped.includes('{') || stripped.includes('}')) {
    throw new Error(`${fieldLabel}.path 只支持 {uid} 与 {scope} 占位符：${accountDir.path}`);
  }
}

function samePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

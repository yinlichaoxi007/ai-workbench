import fs from 'node:fs';
import path from 'node:path';
import { expandPath } from './paths.mjs';
import { buildSettingsEnv, loadSettings } from './settings.mjs';
import {
  checkToolVersion,
  detectToolVersion,
  normalizeVersionSpec
} from './tool-version.mjs';

const VALID_STATUS = new Set(['verified', 'documented', 'unverified', 'unsupported']);
const VALID_STRATEGY = new Set(['block-append', 'separate-file']);
const VALID_FORMAT = new Set(['markdown', 'mdc']);

/**
 * 读取并校验工具目标注册表，应用机器档案中的路径覆盖与环境变量，同时解析安装状态。
 * @param {string} repoRoot 仓库根目录
 * @param {{hostname?: string}} [options] 选项
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
      return resolveTool(tool, overrides[tool.id] ?? {}, env, repoRoot);
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

function resolveTool(tool, override, env, repoRoot) {
  const baseConfigRoot = expandPath(tool.configRoot, env);
  const baseEntryPath = expandPath(tool.entry.path, env);
  const baseAlternativePaths = (tool.entry.alternatives ?? []).map((item) => expandPath(item, env));
  const baseSkillsDir = tool.skillsDir ? expandPath(tool.skillsDir, env) : null;

  const hasEntryOverride = typeof override.entryPath === 'string';
  const configRoot = expandPath(override.configRoot ?? tool.configRoot, env);
  const primaryEntryPath = expandPath(override.entryPath ?? tool.entry.path, env);
  const alternativePaths = hasEntryOverride ? [] : baseAlternativePaths;
  const candidates = [primaryEntryPath, ...alternativePaths];
  const existingPath = candidates.find((candidate) => fs.existsSync(candidate));
  const entryPath = existingPath ?? primaryEntryPath;
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
    entryPrimaryPath: primaryEntryPath,
    entryAlternatives: alternativePaths,
    entryPath,
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
  if (!VALID_STRATEGY.has(strategy)) {
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
      strategy
    },
    frontmatter: typeof tool.frontmatter === 'string' ? tool.frontmatter : '',
    entryPrimaryPath: entryPath,
    entryAlternatives: [],
    entryPath,
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

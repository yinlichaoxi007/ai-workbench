import fs from 'node:fs';
import path from 'node:path';
import { expandHome } from './paths.mjs';

const VALID_STATUS = new Set(['verified', 'documented', 'unverified', 'unsupported']);
const VALID_STRATEGY = new Set(['block-append', 'separate-file']);
const VALID_FORMAT = new Set(['markdown', 'mdc']);

/**
 * 读取并校验工具目标注册表，同时解析本机路径和安装状态。
 * @param {string} repoRoot 仓库根目录
 * @returns {Array<Record<string, unknown>>} 目标列表
 */
export function loadTargets(repoRoot) {
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

  const ids = new Set();
  return registry.tools.map((tool) => {
    validateTool(tool, registryPath);
    if (ids.has(tool.id)) {
      throw new Error(`目标注册表存在重复 id：${tool.id}`);
    }
    ids.add(tool.id);

    const configRoot = expandHome(tool.configRoot);
    const primaryEntryPath = expandHome(tool.entry.path);
    const alternativePaths = (tool.entry.alternatives ?? []).map(expandHome);
    const candidates = [primaryEntryPath, ...alternativePaths];
    const existingPath = candidates.find((candidate) => fs.existsSync(candidate));
    const entryPath = existingPath ?? primaryEntryPath;
    const skillsDir = tool.skillsDir ? expandHome(tool.skillsDir) : null;

    return {
      ...tool,
      configRoot,
      entryPrimaryPath: primaryEntryPath,
      entryAlternatives: alternativePaths,
      entryPath,
      entryExists: Boolean(existingPath),
      usingFallback: Boolean(existingPath && existingPath !== primaryEntryPath),
      enabled: tool.enabled !== false,
      installed: tool.enabled !== false && fs.existsSync(configRoot),
      skillsDir,
      skillsDirExists: Boolean(skillsDir && fs.existsSync(skillsDir)),
      frontmatterTemplate: tool.entry.frontmatterTemplate
        ? path.join(repoRoot, tool.entry.frontmatterTemplate)
        : null
    };
  });
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
}

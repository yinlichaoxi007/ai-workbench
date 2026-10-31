import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from './fs-safe.mjs';

const DEFAULT_STATE = {
  version: 1,
  machine: null,
  lastRun: null,
  targets: {},
  projects: {}
};

/**
 * 返回部署状态文件路径。
 * @param {string} repoRoot 仓库根目录
 * @returns {string} 状态文件路径
 */
export function statePath(repoRoot) {
  return path.join(repoRoot, 'state', 'deploy-state.json');
}

/**
 * 读取部署状态；文件不存在时返回空状态，文件损坏时拒绝继续。
 * @param {string} repoRoot 仓库根目录
 * @returns {{version: number, machine: string|null, lastRun: string|null, targets: Record<string, object>, projects: Record<string, object>}} 部署状态
 */
export function readState(repoRoot) {
  const filePath = statePath(repoRoot);
  if (!fs.existsSync(filePath)) return structuredClone(DEFAULT_STATE);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `部署状态文件无法解析：${filePath}。请修复或移到回收站后再试（${error.message}）。`
    );
  }

  return {
    ...structuredClone(DEFAULT_STATE),
    ...parsed,
    targets: parsed.targets ?? {},
    projects: parsed.projects ?? {}
  };
}

/**
 * 写入部署状态，使用临时文件加原子替换。
 * @param {string} repoRoot 仓库根目录
 * @param {ReturnType<typeof readState>} state 部署状态
 * @returns {string} 状态文件路径
 */
export function writeState(repoRoot, state) {
  const filePath = statePath(repoRoot);
  atomicWriteFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return filePath;
}

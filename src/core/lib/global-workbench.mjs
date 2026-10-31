import fs from 'node:fs';
import path from 'node:path';

const WORKBENCH_DIRS = ['todo', 'scripts', 'notes', '_tmp'];
const LINK_NAME = 'ai-workbench';

/**
 * 预演全局工作台的目录与脚本 junction，不写入磁盘。
 * @param {string} repoRoot 仓库根目录
 * @param {string} globalRoot 全局工作台路径
 * @returns {{
 *   globalRoot: string,
 *   sourceDir: string,
 *   linkPath: string,
 *   dirs: Array<{name: string, path: string, action: string, reason: string}>,
 *   link: {name: string, path: string, target: string, currentTarget: string|null, action: string, reason: string},
 *   conflicts: number,
 *   ok: boolean,
 *   applied: boolean
 * }} 预演结果
 */
export function planGlobalWorkbench(repoRoot, globalRoot) {
  const sourceDir = path.join(repoRoot, 'content', 'scripts');
  const linkPath = path.join(globalRoot, 'scripts', LINK_NAME);
  const dirs = WORKBENCH_DIRS.map((name) => planDirectory(name, path.join(globalRoot, name)));
  const link = planLink(sourceDir, linkPath);
  const conflicts = [...dirs, link].filter((entry) => entry.action === 'conflict').length;

  return {
    globalRoot,
    sourceDir,
    linkPath,
    dirs,
    link,
    conflicts,
    ok: conflicts === 0,
    applied: false
  };
}

/**
 * 按预演结果创建缺失目录与脚本 junction；存在冲突时不写入任何内容。
 * @param {ReturnType<typeof planGlobalWorkbench>} plan 预演结果
 * @returns {ReturnType<typeof planGlobalWorkbench>} 带 applied 标记的结果
 */
export function applyGlobalWorkbench(plan) {
  if (!plan.ok) {
    throw new Error(`全局工作台存在 ${plan.conflicts} 处冲突，未写入任何内容。`);
  }

  fs.mkdirSync(plan.globalRoot, { recursive: true });

  for (const dir of plan.dirs) {
    if (dir.action === 'create-directory') {
      fs.mkdirSync(dir.path, { recursive: true });
    }
  }

  if (plan.link.action === 'create-junction') {
    fs.mkdirSync(path.dirname(plan.link.path), { recursive: true });
    fs.symlinkSync(plan.link.target, plan.link.path, 'junction');
  }

  return { ...plan, applied: true };
}

function planDirectory(name, dirPath) {
  let stat;
  try {
    stat = fs.statSync(dirPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { name, path: dirPath, action: 'create-directory', reason: '目录不存在' };
    }
    return { name, path: dirPath, action: 'conflict', reason: `无法访问：${error.message}` };
  }

  if (!stat.isDirectory()) {
    return { name, path: dirPath, action: 'conflict', reason: '同名路径不是目录' };
  }
  return { name, path: dirPath, action: 'unchanged', reason: '目录已存在' };
}

function planLink(sourceDir, linkPath) {
  const base = { name: LINK_NAME, path: linkPath, target: sourceDir, currentTarget: null };

  let sourceStat;
  try {
    sourceStat = fs.statSync(sourceDir);
  } catch (error) {
    return {
      ...base,
      action: 'conflict',
      reason: error.code === 'ENOENT' ? `脚本源不存在：${sourceDir}` : `脚本源无法访问：${error.message}`
    };
  }

  if (!sourceStat.isDirectory()) {
    return { ...base, action: 'conflict', reason: `脚本源不是目录：${sourceDir}` };
  }

  let stat;
  try {
    stat = fs.lstatSync(linkPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ...base, action: 'create-junction', reason: '链接不存在' };
    }
    return { ...base, action: 'conflict', reason: `无法访问：${error.message}` };
  }

  if (stat.isSymbolicLink()) {
    let currentTarget;
    try {
      currentTarget = fs.realpathSync(linkPath);
    } catch (error) {
      return { ...base, action: 'conflict', reason: `链接无法解析：${error.message}` };
    }

    const expected = fs.realpathSync(sourceDir);
    if (samePath(currentTarget, expected)) {
      return { ...base, currentTarget, action: 'unchanged', reason: '已指向脚本源' };
    }
    return { ...base, currentTarget, action: 'conflict', reason: `已指向其他位置：${currentTarget}` };
  }

  return { ...base, action: 'conflict', reason: '已存在同名路径且不是 junction' };
}

function samePath(left, right) {
  const normalize = (value) =>
    path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
  return normalize(left) === normalize(right);
}

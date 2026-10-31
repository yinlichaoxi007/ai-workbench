import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatLocalIso } from './time.mjs';

const STALE_MS = 30 * 60 * 1000;

/**
 * 返回部署锁文件路径。
 * @param {string} repoRoot 仓库根目录
 * @returns {string} 锁文件路径
 */
export function deployLockPath(repoRoot) {
  return path.join(repoRoot, 'state', 'locks', 'deploy.lock');
}

/**
 * 获取部署锁；已有未超时的锁时拒绝，超时锁视为陈旧并接管。
 * @param {string} repoRoot 仓库根目录
 * @param {{now?: Date, staleMs?: number}} [options] 选项
 * @returns {{path: string, token: string, acquiredAt: string, release: () => boolean}} 锁句柄
 */
export function acquireLock(repoRoot, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const staleMs = options.staleMs ?? STALE_MS;
  const filePath = deployLockPath(repoRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const token = randomUUID();
  const acquiredAt = formatLocalIso(now);
  const payload = `${JSON.stringify(
    { token, pid: process.pid, host: os.hostname(), acquiredAt },
    null,
    2
  )}\n`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(filePath, payload, { encoding: 'utf8', flag: 'wx' });
      return {
        path: filePath,
        token,
        acquiredAt,
        release: () => releaseLock(filePath, token)
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      const existing = inspectLock(filePath, now, staleMs);
      if (!existing.stale) {
        throw new Error(
          `部署锁已被占用：${filePath}（PID ${existing.pid ?? '未知'}，获取于 ${
            existing.acquiredAt ?? '未知'
          }）。请确认没有其他部署进程，或等锁超过 ${Math.round(staleMs / 60000)} 分钟后重试。`
        );
      }
      fs.rmSync(filePath, { force: true });
    }
  }

  throw new Error(`无法获取部署锁：${filePath}`);
}

/**
 * 释放自己持有的锁；锁已被他人替换时保持不动。
 * @param {string} filePath 锁文件路径
 * @param {string} token 锁令牌
 * @returns {boolean} 是否删除成功
 */
export function releaseLock(filePath, token) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return false;
  }

  if (parsed?.token !== token) return false;
  fs.rmSync(filePath, { force: true });
  return true;
}

function inspectLock(filePath, now, staleMs) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    return { stale: error.code === 'ENOENT' };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    // 损坏的锁按文件修改时间判断。
  }

  const acquired = Date.parse(parsed?.acquiredAt ?? '');
  const reference = Number.isFinite(acquired) ? acquired : stat.mtimeMs;

  return {
    pid: parsed?.pid ?? null,
    acquiredAt: parsed?.acquiredAt ?? stat.mtime.toISOString(),
    stale: now.getTime() - reference > staleMs
  };
}

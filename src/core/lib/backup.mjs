import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from './fs-safe.mjs';
import { sha256 } from './hash.mjs';
import { toPosixPath } from './paths.mjs';
import { formatLocalIso, formatStamp } from './time.mjs';

/**
 * 写入前备份入口文件，并写 manifest 记录原路径与原哈希。
 * @param {string} repoRoot 仓库根目录
 * @param {{
 *   toolId: string,
 *   entryPath: string,
 *   action: string,
 *   now?: Date
 * }} options 备份输入
 * @returns {{
 *   dir: string,
 *   relativeDir: string,
 *   fileName: string,
 *   filePath: string,
 *   originalHash: string,
 *   existed: boolean
 * }} 备份信息
 */
export function createBackup(repoRoot, options) {
  const now = options.now instanceof Date ? options.now : new Date();
  const baseDir = path.join(repoRoot, 'state', 'backups', options.toolId);
  const dir = uniqueDir(baseDir, formatStamp(now));
  const fileName = path.basename(options.entryPath);
  const filePath = path.join(dir, fileName);

  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(options.entryPath, filePath);

  const manifest = {
    version: 1,
    tool: options.toolId,
    entryPath: options.entryPath,
    fileName,
    action: options.action,
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
    relativeDir: toPosixPath(path.relative(repoRoot, dir)),
    fileName,
    filePath,
    originalHash: manifest.originalHash,
    existed: true
  };
}

/**
 * 用备份恢复入口；原来不存在的文件直接删除。
 * @param {ReturnType<typeof createBackup>|null} backup 备份信息
 * @param {string} entryPath 入口路径
 * @returns {'restored'|'removed'|'none'} 恢复方式
 */
export function restoreBackup(backup, entryPath) {
  if (!backup) return 'none';

  if (!backup.existed) {
    fs.rmSync(entryPath, { force: true });
    return 'removed';
  }

  atomicWriteFile(entryPath, fs.readFileSync(backup.filePath));
  return 'restored';
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

import fs from 'node:fs';
import { createBackup, restoreBackup } from './backup.mjs';
import { decodeText, encodeText } from './encoding.mjs';
import { atomicWriteFile } from './fs-safe.mjs';
import { sha256 } from './hash.mjs';
import { appendBlock, findBlock, replaceBlock } from './merge-engine.mjs';

const WRITABLE_ACTIONS = new Set(['create-file', 'append-block', 'update-block']);

/**
 * 判断计划动作是否可以直接写入。
 * @param {string} action 动作
 * @returns {boolean} 是否可写
 */
export function isWritableAction(action) {
  return WRITABLE_ACTIONS.has(action);
}

/**
 * 按预演结果写入入口：写前备份、原子写、写后校验，失败恢复备份。
 * @param {{
 *   repoRoot: string,
 *   target: {id: string, entryPath: string},
 *   plan: object,
 *   now?: Date
 * }} options 写入输入
 * @returns {{
 *   status: 'written',
 *   action: string,
 *   blockHash: string,
 *   fileHash: string,
 *   backup: string|null,
 *   adopted: false
 * }} 写入结果
 */
export function applyTargetPlan({ repoRoot, target, plan, now = new Date() }) {
  if (!isWritableAction(plan.action)) {
    throw new Error(`目标 ${target.id} 的动作 ${plan.action} 不能直接写入`);
  }

  const current = readEntry(target.entryPath);
  if (current.hash !== (plan.fileHash ?? null)) {
    throw new Error(
      `入口在预演后发生变化，未写入：${target.entryPath}。请重新运行 deploy 预演确认。`
    );
  }

  const nextText = buildNextText({ current, plan, target });
  const buffer = encodeText(nextText, {
    encoding: current.exists ? current.encoding : 'utf-8',
    hasBom: current.exists ? current.hasBom : false
  });

  const backup = current.exists
    ? createBackup(repoRoot, {
        toolId: target.id,
        entryPath: target.entryPath,
        action: plan.action,
        now
      })
    : null;

  try {
    atomicWriteFile(target.entryPath, buffer);
    verifyWritten(target.entryPath, buffer, plan.blockHash);
  } catch (error) {
    let rollbackNote;
    try {
      rollback(backup, target.entryPath, current.exists);
      rollbackNote = rollbackLabel(backup);
    } catch (rollbackError) {
      rollbackNote = `回滚失败，请按备份手工恢复（${rollbackError.message}）`;
    }
    throw new Error(`写入 ${target.entryPath} 失败，${rollbackNote}：${error.message}`);
  }

  return {
    status: 'written',
    action: plan.action,
    blockHash: plan.blockHash,
    fileHash: sha256(buffer),
    backup: backup?.relativeDir ?? null,
    adopted: false
  };
}

function buildNextText({ current, plan, target }) {
  if (plan.action === 'create-file') {
    if (current.exists && plan.fileContent === undefined) {
      throw new Error(`计划新建入口，但文件已存在：${target.entryPath}`);
    }
    return plan.fileContent ?? `${plan.blockText}\n`;
  }

  if (current.text === null) {
    throw new Error(`入口不是可写文本：${target.entryPath}`);
  }

  if (plan.action === 'append-block') {
    if (findBlock(current.text).status !== 'absent') {
      throw new Error(`入口已包含工作台块或标记异常，未追加：${target.entryPath}`);
    }
    return appendBlock(current.text, plan.blockText);
  }

  return replaceBlock(current.text, plan.replacement);
}

function verifyWritten(entryPath, expectedBuffer, expectedBlockHash) {
  const written = fs.readFileSync(entryPath);
  if (sha256(written) !== sha256(expectedBuffer)) {
    throw new Error('写后字节校验不一致');
  }

  const decoded = decodeText(written);
  if (decoded.text === null) {
    throw new Error(`写后文件无法解码为文本（检测为 ${decoded.encoding}）`);
  }

  const found = findBlock(decoded.text);
  if (found.status !== 'present') {
    throw new Error(`写后未找到完整工作台块（${found.status}）`);
  }
  if (found.blockHash !== expectedBlockHash) {
    throw new Error('写后块哈希与计划不一致');
  }
}

function readEntry(entryPath) {
  if (!fs.existsSync(entryPath)) {
    return { exists: false, hash: null, text: null, encoding: 'utf-8', hasBom: false };
  }

  const buffer = fs.readFileSync(entryPath);
  const decoded = decodeText(buffer);
  return {
    exists: true,
    hash: sha256(buffer),
    text: decoded.text,
    encoding: decoded.encoding,
    hasBom: decoded.hasBom
  };
}

function rollback(backup, entryPath, existedBefore) {
  if (backup) {
    restoreBackup(backup, entryPath);
    return;
  }
  if (!existedBefore) {
    fs.rmSync(entryPath, { force: true });
  }
}

function rollbackLabel(backup) {
  return backup ? '已从备份恢复原文件' : '已清理新建文件';
}

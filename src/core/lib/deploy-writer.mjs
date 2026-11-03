import fs from 'node:fs';
import { createBackup, restoreBackup } from './backup.mjs';
import { decodeText, encodeText } from './encoding.mjs';
import { atomicWriteFile } from './fs-safe.mjs';
import { sha256 } from './hash.mjs';
import { countChars } from './memory-block.mjs';
import { appendBlock, findBlock, replaceBlock } from './merge-engine.mjs';

const WRITABLE_ACTIONS = new Set([
  'create-file',
  'append-block',
  'insert-block',
  'update-block'
]);

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
 * 记忆注入目标先写拆分文件，再写记忆入口。
 * @param {{
 *   repoRoot: string,
 *   target: {id: string, entryPath: string, strategy?: string, entry?: object},
 *   plan: object,
 *   now?: Date
 * }} options 写入输入
 * @returns {{
 *   status: 'written',
 *   action: string,
 *   blockHash: string,
 *   fileHash: string,
 *   backup: string|null,
 *   splitFilePath?: string|null,
 *   splitFileHash?: string|null,
 *   memoryMode?: string|null,
 *   splitBackup?: string|null,
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

  if (target.strategy === 'memory-block') {
    return applyMemoryPlan({ repoRoot, target, plan, current, now });
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

function applyMemoryPlan({ repoRoot, target, plan, current, now }) {
  const markers = plan.markers ?? target.entry?.markers;
  const splitPath = plan.splitFilePath ?? target.entry?.splitFilePath;
  if (!markers || !splitPath) {
    throw new Error(`记忆注入目标缺少标记或拆分文件路径：${target.id}`);
  }
  if (typeof plan.nextText !== 'string') {
    throw new Error(`记忆注入目标缺少写入内容：${target.id}`);
  }

  const splitCurrent = readEntry(splitPath);
  if (splitCurrent.hash !== (plan.splitFileCurrentHash ?? null)) {
    throw new Error(
      `拆分文件在预演后发生变化，未写入：${splitPath}。请重新运行 deploy 预演确认。`
    );
  }

  const splitAction = plan.splitAction ?? 'none';
  if (!['none', 'create', 'update', 'remove'].includes(splitAction)) {
    throw new Error(`未知拆分文件动作：${splitAction}`);
  }

  assertMemoryMarkers(current.text, current.exists, plan.action, markers);
  const nextBuffer = encodeText(plan.nextText, {
    encoding: current.exists ? current.encoding : 'utf-8',
    hasBom: current.exists ? current.hasBom : false
  });
  assertNoNewlineDrift(current, plan.nextText);

  const entryBackup = current.exists
    ? createBackup(repoRoot, {
        toolId: target.id,
        entryPath: target.entryPath,
        action: plan.action,
        now
      })
    : null;
  const splitBackup =
    splitCurrent.exists && (splitAction === 'update' || splitAction === 'remove')
      ? createBackup(repoRoot, {
          toolId: target.id,
          entryPath: splitPath,
          action: `deploy-split-${splitAction}`,
          now
        })
      : null;

  try {
    if (splitAction === 'create' || splitAction === 'update') {
      atomicWriteFile(splitPath, Buffer.from(plan.splitFileContent, 'utf8'));
      verifySplitFile(splitPath, plan.splitFileHash);
    } else if (splitAction === 'remove') {
      fs.rmSync(splitPath, { force: true });
      if (fs.existsSync(splitPath)) throw new Error('拆分文件删除后仍然存在');
    }

    atomicWriteFile(target.entryPath, nextBuffer);
    verifyMemoryWritten(target.entryPath, nextBuffer, {
      blockHash: plan.blockHash,
      totalChars: plan.totalChars,
      markers,
      hasBom: current.exists ? current.hasBom : false,
      hadCrlf: Boolean(current.text && current.text.includes('\r\n'))
    });
  } catch (error) {
    let entryNote;
    let splitNote;
    try {
      rollback(entryBackup, target.entryPath, current.exists);
      entryNote = rollbackLabel(entryBackup);
    } catch (rollbackError) {
      entryNote = `入口回滚失败，请按备份手工恢复（${rollbackError.message}）`;
    }
    try {
      rollbackSplit(splitBackup, splitPath, splitCurrent.exists, splitAction);
      splitNote = splitBackup ? '拆分文件已从备份恢复' : '拆分文件已回滚';
    } catch (rollbackError) {
      splitNote = `拆分文件回滚失败，请按备份手工恢复（${rollbackError.message}）`;
    }
    throw new Error(
      `写入 ${target.entryPath} 失败，${entryNote}；${splitNote}：${error.message}`
    );
  }

  return {
    status: 'written',
    action: plan.action,
    blockHash: plan.blockHash,
    fileHash: sha256(nextBuffer),
    backup: entryBackup?.relativeDir ?? null,
    splitFilePath:
      splitAction === 'remove' || plan.memoryMode === 'inline' ? null : splitPath,
    splitFileHash: splitAction === 'remove' ? null : plan.splitFileHash,
    memoryMode: plan.memoryMode ?? null,
    splitBackup: splitBackup?.relativeDir ?? null,
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

function assertMemoryMarkers(currentText, exists, action, markers) {
  if (action === 'create-file') {
    if (exists || (currentText !== null && currentText !== undefined)) {
      throw new Error('计划新建记忆文件，但文件已存在');
    }
    return;
  }

  if (currentText === null || currentText === undefined) {
    throw new Error(`记忆文件不存在，无法执行 ${action}`);
  }

  const found = findBlock(currentText, markers);
  if (action === 'insert-block' && found.status !== 'absent') {
    throw new Error('记忆文件中已存在区块或标记异常，未插入');
  }
  if (action === 'update-block' && found.status !== 'present') {
    throw new Error(`记忆文件中的区块不可更新（${found.status}）`);
  }
}

function assertNoNewlineDrift(current, nextText) {
  if (current.text && !current.text.includes('\r\n') && nextText.includes('\r\n')) {
    throw new Error('写入内容引入了 CRLF，原文件为纯 LF');
  }
}

function verifyMemoryWritten(entryPath, expectedBuffer, options) {
  const written = fs.readFileSync(entryPath);
  if (sha256(written) !== sha256(expectedBuffer)) {
    throw new Error('写后字节校验不一致');
  }

  const decoded = decodeText(written);
  if (decoded.text === null) {
    throw new Error(`写后文件无法解码为文本（检测为 ${decoded.encoding}）`);
  }
  if (decoded.hasBom !== options.hasBom) {
    throw new Error('写后 BOM 形态与写入前不一致');
  }
  if (!options.hadCrlf && decoded.text.includes('\r\n')) {
    throw new Error('写后出现 CRLF，原文件为纯 LF');
  }

  const found = findBlock(decoded.text, options.markers);
  if (found.status !== 'present') {
    throw new Error(`写后未找到唯一记忆区块（${found.status}）`);
  }
  if (found.blockHash !== options.blockHash) {
    throw new Error('写后区块哈希与计划不一致');
  }

  const actualChars = countChars(decoded.text);
  if (actualChars !== options.totalChars) {
    throw new Error(`写后字符数 ${actualChars} 与计划 ${options.totalChars} 不一致`);
  }
}

function verifySplitFile(splitPath, expectedHash) {
  if (!fs.existsSync(splitPath)) throw new Error('拆分文件写入后不存在');
  const actual = sha256(fs.readFileSync(splitPath));
  if (actual !== expectedHash) throw new Error('拆分文件写后哈希与计划不一致');
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

function rollbackSplit(backup, splitPath, existedBefore, splitAction) {
  if (backup) {
    restoreBackup(backup, splitPath);
    return;
  }
  if (!existedBefore && splitAction === 'create') {
    fs.rmSync(splitPath, { force: true });
  }
}

function rollbackLabel(backup) {
  return backup ? '已从备份恢复原文件' : '已清理新建文件';
}

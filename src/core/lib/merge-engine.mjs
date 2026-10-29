import { convertNewlines, detectNewline, normalizeNewlines } from './encoding.mjs';
import { sha256 } from './hash.mjs';

export const BEGIN_MARKER = '<!-- AI-WORKBENCH:BEGIN -->';
export const END_MARKER = '<!-- AI-WORKBENCH:END -->';

/**
 * 用工作台标记包裹入口内容。
 * @param {string} inner 入口正文
 * @param {'\r\n'|'\n'} [newline] 换行风格
 * @returns {string} 带标记的块
 */
export function wrapBlock(inner, newline = '\n') {
  const body = convertNewlines(normalizeNewlines(inner).trimEnd(), newline);
  return `${BEGIN_MARKER}${newline}${body}${newline}${END_MARKER}`;
}

/**
 * 查找文件中的工作台块。
 * @param {string} text 文件内容
 * @returns {{status: 'absent'}|{status: 'malformed', reason: string}|{status: 'present', beginIndex: number, endIndex: number, inner: string, blockHash: string}} 查找结果
 */
export function findBlock(text) {
  const beginCount = countOccurrences(text, BEGIN_MARKER);
  const endCount = countOccurrences(text, END_MARKER);

  if (beginCount === 0 && endCount === 0) return { status: 'absent' };
  if (beginCount !== 1 || endCount !== 1) {
    return { status: 'malformed', reason: '工作台块标记重复或缺失' };
  }

  const beginIndex = text.indexOf(BEGIN_MARKER);
  const endIndex = text.indexOf(END_MARKER);
  if (endIndex < beginIndex) {
    return { status: 'malformed', reason: '工作台块标记顺序错误' };
  }

  const rawInner = text.slice(beginIndex + BEGIN_MARKER.length, endIndex);
  const inner = rawInner.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  return {
    status: 'present',
    beginIndex,
    endIndex: endIndex + END_MARKER.length,
    inner,
    blockHash: sha256(normalizeNewlines(inner))
  };
}

/**
 * 规划对已有文件的工作台块合并动作。只规划，不写文件。
 * @param {{
 *   existingText: string|null,
 *   newInner: string,
 *   storedBlockHash?: string|null,
 *   contentUnchanged?: boolean
 * }} options 合并输入
 * @returns {{action: string, reason: string, blockHash?: string, blockText?: string, replacement?: string, adopt?: boolean}} 规划结果
 */
export function planBlockMerge(options) {
  const { existingText, newInner, storedBlockHash = null, contentUnchanged = false } = options;
  const newHash = sha256(normalizeNewlines(newInner));

  if (existingText === null || existingText === undefined) {
    return {
      action: 'create-file',
      reason: '入口文件不存在',
      blockHash: newHash,
      blockText: wrapBlock(newInner)
    };
  }

  const found = findBlock(existingText);
  if (found.status === 'absent') {
    return {
      action: 'append-block',
      reason: '文件中没有工作台块，将追加到文件末尾',
      blockHash: newHash,
      blockText: wrapBlock(newInner, detectNewline(existingText))
    };
  }
  if (found.status === 'malformed') {
    return { action: 'manual', reason: found.reason };
  }

  if (storedBlockHash && found.blockHash !== storedBlockHash) {
    return {
      action: 'manual',
      reason: '工作台块与部署状态记录的哈希不一致，可能被手工修改'
    };
  }

  if (!storedBlockHash) {
    if (found.blockHash === newHash) {
      return {
        action: 'unchanged',
        reason: '块内容与本次构建一致，可接管现有块',
        blockHash: newHash,
        adopt: true
      };
    }
    return {
      action: 'manual',
      reason: '发现工作台块但没有部署状态记录，且内容与本次构建不一致'
    };
  }

  if (contentUnchanged || found.blockHash === newHash) {
    return {
      action: 'unchanged',
      reason: '工作台内容与已部署版本一致',
      blockHash: found.blockHash
    };
  }

  return {
    action: 'update-block',
    reason: '工作台内容已更新',
    blockHash: newHash,
    replacement: wrapBlock(newInner, detectNewline(existingText))
  };
}

/**
 * 规划独立文件的写入动作。文件不存在或为空时创建，已有非工作台内容时停下。
 * @param {{
 *   existingText: string|null,
 *   newInner: string,
 *   storedBlockHash?: string|null,
 *   contentUnchanged?: boolean,
 *   frontmatter?: string
 * }} options 合并输入
 * @returns {{action: string, reason: string, blockHash?: string, fileContent?: string, replacement?: string, adopt?: boolean}} 规划结果
 */
export function planSeparateFile(options) {
  const {
    existingText,
    newInner,
    storedBlockHash = null,
    contentUnchanged = false,
    frontmatter = ''
  } = options;
  const newHash = sha256(normalizeNewlines(newInner));

  if (existingText === null || existingText === undefined || existingText.trim() === '') {
    return {
      action: 'create-file',
      reason: existingText === null || existingText === undefined ? '入口文件不存在' : '入口文件为空',
      blockHash: newHash,
      fileContent: composeSeparateFile(frontmatter, newInner)
    };
  }

  const found = findBlock(existingText);
  if (found.status === 'absent') {
    return {
      action: 'manual',
      reason: '同名文件已存在且不是工作台文件，不能覆盖'
    };
  }
  if (found.status === 'malformed') {
    return { action: 'manual', reason: found.reason };
  }

  if (storedBlockHash && found.blockHash !== storedBlockHash) {
    return {
      action: 'manual',
      reason: '工作台块与部署状态记录的哈希不一致，可能被手工修改'
    };
  }

  if (!storedBlockHash) {
    if (found.blockHash === newHash) {
      return {
        action: 'unchanged',
        reason: '块内容与本次构建一致，可接管现有块',
        blockHash: newHash,
        adopt: true
      };
    }
    return {
      action: 'manual',
      reason: '发现工作台块但没有部署状态记录，且内容与本次构建不一致'
    };
  }

  if (contentUnchanged || found.blockHash === newHash) {
    return {
      action: 'unchanged',
      reason: '工作台内容与已部署版本一致',
      blockHash: found.blockHash
    };
  }

  return {
    action: 'update-block',
    reason: '工作台内容已更新',
    blockHash: newHash,
    replacement: wrapBlock(newInner, detectNewline(existingText))
  };
}

/**
 * 用新块替换文件中的旧块。
 * @param {string} existingText 原文件内容
 * @param {string} blockText 新块
 * @returns {string} 替换后的内容
 */
export function replaceBlock(existingText, blockText) {
  const found = findBlock(existingText);
  if (found.status !== 'present') {
    throw new Error('文件中没有可替换的工作台块');
  }

  const prefix = existingText.slice(0, found.beginIndex);
  const suffix = existingText.slice(found.endIndex);
  const newline = detectNewline(existingText);

  if (!suffix) return `${prefix}${blockText}${newline}`;
  if (!/^\r?\n/.test(suffix)) return `${prefix}${blockText}${newline}${suffix}`;
  return `${prefix}${blockText}${suffix}`;
}

/**
 * 把工作台块追加到文件末尾，保留原换行风格。
 * @param {string} existingText 原文件内容
 * @param {string} blockText 工作台块
 * @returns {string} 追加后的内容
 */
export function appendBlock(existingText, blockText) {
  if (!existingText) return `${blockText}\n`;
  const newline = detectNewline(existingText);
  const prefix = existingText.endsWith('\n') ? existingText : `${existingText}${newline}`;
  return `${prefix}${blockText}${newline}`;
}

/**
 * 组合独立入口文件：frontmatter + 工作台块。
 * @param {string} frontmatter frontmatter 文本
 * @param {string} inner 入口正文
 * @returns {string} 文件内容
 */
export function composeSeparateFile(frontmatter, inner) {
  const head = normalizeNewlines(frontmatter).trimEnd();
  const block = wrapBlock(inner);
  return head ? `${head}\n\n${block}\n` : `${block}\n`;
}

function countOccurrences(text, token) {
  return text.split(token).length - 1;
}

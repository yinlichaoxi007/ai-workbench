import { detectNewline, normalizeNewlines } from './encoding.mjs';
import { sha256 } from './hash.mjs';
import {
  blockContentHash,
  findBlock,
  normalizeMarkers,
  removeBlock,
  replaceBlock,
  wrapBlock
} from './merge-engine.mjs';

export const DEFAULT_MEMORY_MARKERS = Object.freeze({
  begin: '<!-- USER-GLOBAL-RULES:BEGIN -->',
  end: '<!-- USER-GLOBAL-RULES:END -->'
});

export const DEFAULT_MEMORY_BUDGET = Object.freeze({
  injectLimit: 4000,
  targetLimit: 3400,
  blockBudget: 600
});

const SPLIT_FILE_HEADER = [
  '# AI 工作台全局规则',
  '',
  '> 本文件由 AI 工作台自动生成，重新部署会覆盖；请勿手工修改。',
  ''
].join('\n');

/**
 * 按 UTF-8 解码后的码点计数，与 WorkBuddy 的字符口径一致，不做换行归一。
 * @param {string} text 文本
 * @returns {number} 字符数
 */
export function countChars(text) {
  return Array.from(text).length;
}

/**
 * 估算字数，便于和编辑器或工具的字数统计对照；不参与注入上限判断。
 * @param {string} text 文本
 * @returns {number} 估算字数
 */
export function countWords(text) {
  const value = String(text ?? '');
  const han = value.match(/\p{Script=Han}/gu)?.length ?? 0;
  const words = value.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  return han + words;
}

/**
 * 计算对照用的文本统计：含空白字符、不含空白字符与估算字数。
 * @param {string} text 文本
 * @returns {{chars: number, nonWhitespaceChars: number, words: number}} 统计结果
 */
export function countTextStats(text) {
  const value = String(text ?? '');
  return {
    chars: countChars(value),
    nonWhitespaceChars: countChars(value.replace(/\s/g, '')),
    words: countWords(value)
  };
}

/**
 * 生成记忆注入配置。
 * @param {{markers?: object, budget?: object, placement?: string}} [entry] 入口配置
 * @returns {{markers: {begin: string, end: string}, budget: object, placement: 'top'|'bottom'}} 配置
 */
export function memorySpec(entry = {}) {
  return {
    markers: normalizeMarkers(entry.markers ?? DEFAULT_MEMORY_MARKERS),
    budget: normalizeBudget(entry.budget ?? {}),
    placement: entry.placement === 'bottom' ? 'bottom' : 'top'
  };
}

/**
 * 生成写入记忆文件的钩子正文。
 * @param {string} splitFilePath 拆分文件绝对路径
 * @returns {string} 钩子正文
 */
export function buildMemoryHook(splitFilePath) {
  return [
    `AI 工作台全局规则已启用，完整规则见：\`${splitFilePath}\``,
    '开始任务前必须先读取该文件并遵守其中规则；修改规则请回 AI 工作台重新部署，勿手工修改本区块。'
  ].join('\n');
}

/**
 * 生成拆分文件内容，固定 UTF-8 无 BOM 与 LF。
 * @param {string} inner 工作台入口正文
 * @returns {string} 拆分文件内容
 */
export function buildSplitFileContent(inner) {
  return `${SPLIT_FILE_HEADER}${normalizeNewlines(inner).trimEnd()}\n`;
}

/**
 * 计算拆分文件内容哈希。
 * @param {string} content 内容
 * @returns {string} sha256
 */
export function splitFileHashOf(content) {
  return sha256(Buffer.from(content, 'utf8'));
}

/**
 * 在记忆文件中插入区块。顶部插入只加一个换行，保证移除后可还原原文件。
 * @param {string} existingText 原文件内容
 * @param {string} blockText 区块
 * @param {'top'|'bottom'} [placement] 插入位置
 * @returns {string} 插入后的内容
 */
export function insertMemoryBlock(existingText, blockText, placement = 'top') {
  if (!existingText) return `${blockText}\n`;

  const newline = detectNewline(existingText);
  if (placement === 'top') {
    return `${blockText}${newline}${existingText}`;
  }

  const prefix = existingText.endsWith('\n') ? existingText : `${existingText}${newline}`;
  return `${prefix}${blockText}${newline}`;
}

/**
 * 从记忆文件移除区块，保留块外内容。
 * @param {string} existingText 原文件内容
 * @param {object} [markers] 首尾标记
 * @returns {string} 移除后的内容
 */
export function removeMemoryBlock(existingText, markers = DEFAULT_MEMORY_MARKERS) {
  return removeBlock(existingText, markers);
}

/**
 * 规划记忆注入写入：区块唯一、预算内联、超预算钩子加拆分文件。
 * @param {{
 *   existingText: string|null,
 *   workbenchInner: string,
 *   splitFilePath: string,
 *   storedBlockHash?: string|null,
 *   storedSplitFileHash?: string|null,
 *   contentUnchanged?: boolean,
 *   splitFile?: {exists: boolean, text: string|null, hash: string|null}|null,
 *   markers?: object,
 *   budget?: object,
 *   placement?: 'top'|'bottom'
 * }} options 规划输入
 * @returns {object} 规划结果
 */
export function planMemoryBlock(options) {
  const {
    existingText = null,
    workbenchInner,
    splitFilePath,
    storedBlockHash = null,
    storedSplitFileHash = null,
    contentUnchanged = false,
    splitFile = null,
    markers = DEFAULT_MEMORY_MARKERS,
    budget: budgetInput = {},
    placement = 'top'
  } = options;

  const spec = normalizeMarkers(markers);
  const budget = normalizeBudget(budgetInput);
  const fullInner = normalizeNewlines(String(workbenchInner ?? '')).trimEnd();
  if (!fullInner) throw new Error('工作台内容为空，不能写入记忆文件');
  if (!splitFilePath) throw new Error('记忆注入缺少拆分文件路径');

  const exists = typeof existingText === 'string';
  const found = exists ? findBlock(existingText, spec) : { status: 'absent' };
  const newline = exists ? detectNewline(existingText) : '\n';

  if (found.status === 'malformed') {
    return manualPlan(`记忆区块标记异常：${found.reason}；未写入。`);
  }

  if (found.status === 'present' && storedBlockHash && found.blockHash !== storedBlockHash) {
    return manualPlan('记忆区块与部署记录不一致，可能被手工修改；未写入。请先核对或从备份恢复。');
  }

  const splitContent = buildSplitFileContent(fullInner);
  const desiredSplitHash = splitFileHashOf(splitContent);
  const inlineBlock = wrapBlock(fullInner, newline, spec);
  const inlineNext = buildNextText({
    existingText,
    found,
    blockText: inlineBlock,
    placement,
    markers: spec
  });
  const inlineFits =
    countChars(inlineBlock) <= budget.blockBudget &&
    countChars(inlineNext) <= budget.targetLimit &&
    countChars(inlineNext) <= budget.injectLimit;

  const mode = inlineFits ? 'inline' : 'hook';
  const blockInner =
    mode === 'inline' ? fullInner : buildMemoryHook(splitFilePath);
  const blockText = wrapBlock(blockInner, newline, spec);
  const nextText = buildNextText({
    existingText,
    found,
    blockText,
    placement,
    markers: spec
  });
  const blockHash = blockContentHash(blockInner);
  const blockChars = countChars(blockText);
  const totalStats = countTextStats(nextText);
  const totalChars = totalStats.chars;
  const warnings = [];

  if (mode === 'hook' && blockChars > budget.blockBudget) {
    return manualPlan(
      `钩子区块 ${blockChars} 字符，超过区块预算 ${budget.blockBudget}；请缩短拆分文件路径或调整预算。`
    );
  }
  if (totalChars > budget.injectLimit) {
    if (mode === 'hook' && placement === 'top') {
      warnings.push(
        `记忆文件合计 ${totalChars} 字符，超过每会话注入上限 ${budget.injectLimit}；区块已置顶，确保优先注入。`
      );
    } else {
      return manualPlan(
        `记忆文件合计 ${totalChars} 字符，超过每会话注入上限 ${budget.injectLimit}，且区块不在顶部，注入时会丢失。`
      );
    }
  }
  if (mode === 'hook' && totalChars > budget.targetLimit) {
    warnings.push(
      `记忆文件合计 ${totalChars} 字符，超过目标线 ${budget.targetLimit}；已只保留钩子，具体内容见拆分文件。`
    );
  }

  if (found.status === 'present' && !storedBlockHash && found.blockHash !== blockHash) {
    return manualPlan('发现记忆区块但没有部署记录，且内容与本次构建不一致；未写入。');
  }

  const splitPlan = planSplitFile({
    mode,
    splitFile,
    splitContent,
    desiredSplitHash,
    storedSplitFileHash,
    warnings
  });
  if (splitPlan.manual) return manualPlan(splitPlan.manual);

  const changedBlock = found.status !== 'present' || found.blockHash !== blockHash;
  const changedSplit = splitPlan.action !== 'none';
  let action;
  if (!exists) action = 'create-file';
  else if (found.status === 'absent') action = 'insert-block';
  else if (changedBlock || changedSplit) action = 'update-block';
  else action = 'unchanged';

  const adopt = found.status === 'present' && !storedBlockHash && found.blockHash === blockHash;
  const reason = planReason({ action, mode, splitPlan, placement, changedBlock, changedSplit });

  return {
    action,
    reason,
    markers: spec,
    memoryMode: mode,
    placement,
    blockHash,
    blockText,
    blockChars,
    totalChars,
    totalNonWhitespaceChars: totalStats.nonWhitespaceChars,
    totalWords: totalStats.words,
    nextText: action === 'unchanged' ? null : nextText,
    replacement: action === 'update-block' ? blockText : undefined,
    splitFilePath,
    splitAction: splitPlan.action,
    splitFileContent: splitPlan.action === 'create' || splitPlan.action === 'update'
      ? splitContent
      : null,
    splitFileHash: splitPlan.stateHash,
    splitFileCurrentHash: splitFile?.hash ?? null,
    splitFileExists: splitFile?.exists === true,
    adopt,
    warnings,
    budget
  };
}

function buildNextText({ existingText, found, blockText, placement, markers }) {
  if (!existingText) return `${blockText}\n`;
  if (found.status === 'present') return replaceBlock(existingText, blockText, markers);
  return insertMemoryBlock(existingText, blockText, placement);
}

function planSplitFile({
  mode,
  splitFile,
  splitContent,
  desiredSplitHash,
  storedSplitFileHash,
  warnings
}) {
  const exists = splitFile?.exists === true;
  const currentHash = splitFile?.hash ?? null;

  if (mode === 'inline') {
    if (!exists) return { action: 'none', stateHash: null };
    const owned = storedSplitFileHash
      ? currentHash === storedSplitFileHash
      : splitFile.text === splitContent;
    if (owned) return { action: 'remove', stateHash: null };
    warnings.push('拆分文件不是本工作台生成的内容，保留不动。');
    return { action: 'none', stateHash: currentHash };
  }

  if (!exists) return { action: 'create', stateHash: desiredSplitHash };
  if (splitFile.text === null) {
    return { action: 'manual', manual: '拆分文件不是可读 UTF-8 文本，不能覆盖。' };
  }
  if (storedSplitFileHash) {
    if (currentHash !== storedSplitFileHash) {
      return {
        action: 'manual',
        manual: '拆分文件与部署记录不一致，可能被手工修改；未写入。请先核对或从备份恢复。'
      };
    }
    return {
      action: currentHash === desiredSplitHash ? 'none' : 'update',
      stateHash: desiredSplitHash
    };
  }
  if (splitFile.text === splitContent) {
    return { action: 'none', stateHash: desiredSplitHash };
  }
  return {
    action: 'manual',
    manual: '拆分文件已存在且不是工作台生成的内容，不能覆盖；请先移走该文件。'
  };
}

function planReason({ action, mode, splitPlan, placement, changedBlock, changedSplit }) {
  if (action === 'unchanged') return '记忆区块与拆分文件均与当前构建一致';
  const modeLabel = mode === 'inline' ? '内联规则' : '钩子加拆分文件';
  if (action === 'create-file') return `记忆文件不存在，将新建并写入${modeLabel}`;
  if (action === 'insert-block') {
    return `记忆文件中没有工作台区块，将插入到${
      placement === 'top' ? '顶部' : '末尾'
    }（${modeLabel}）`;
  }
  if (!changedBlock && changedSplit) {
    if (splitPlan.action === 'remove') return '内容已能内联，将移除上次部署的拆分文件';
    if (splitPlan.action === 'create') return '拆分文件缺失，将补写拆分文件';
    return '拆分文件内容已更新，将同步写入';
  }
  return `记忆区块内容已更新（${modeLabel}）`;
}

function manualPlan(reason) {
  return { action: 'manual', reason, canApply: false };
}

function normalizeBudget(input) {
  const injectLimit = positiveInt(input.injectLimit ?? DEFAULT_MEMORY_BUDGET.injectLimit, 'injectLimit');
  const targetLimit = positiveInt(input.targetLimit ?? DEFAULT_MEMORY_BUDGET.targetLimit, 'targetLimit');
  const blockBudget = positiveInt(input.blockBudget ?? DEFAULT_MEMORY_BUDGET.blockBudget, 'blockBudget');
  if (targetLimit > injectLimit) {
    throw new Error(`targetLimit 不能大于 injectLimit：${targetLimit} > ${injectLimit}`);
  }
  return { injectLimit, targetLimit, blockBudget };
}

function positiveInt(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} 必须是大于 0 的整数：${value}`);
  }
  return value;
}

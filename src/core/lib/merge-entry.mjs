import { detectNewline, normalizeNewlines } from './encoding.mjs';
import {
  appendBlock,
  blockContentHash,
  composeSeparateFile,
  findBlock,
  replaceBlock,
  wrapBlock
} from './merge-engine.mjs';

/**
 * 规划手工合并：给出建议结果、阻止原因和需要提醒的状态差异。
 * @param {{
 *   existingText: string|null,
 *   workbenchInner: string,
 *   storedBlockHash?: string|null,
 *   strategy: 'block-append'|'separate-file',
 *   frontmatter?: string
 * }} options 合并输入
 * @returns {object} 合并计划
 */
export function planEntryMerge(options) {
  const {
    existingText = null,
    workbenchInner,
    storedBlockHash = null,
    strategy,
    frontmatter = ''
  } = options;

  assertStrategy(strategy);
  if (!String(workbenchInner ?? '').trim()) {
    throw new Error('工作台内容为空，不能合并');
  }

  const exists = typeof existingText === 'string';
  const newline = exists ? detectNewline(existingText) : '\n';
  const found = exists ? findBlock(existingText) : { status: 'absent' };
  const workbenchBlockHash = blockContentHash(workbenchInner);
  const currentBlockHash = found.status === 'present' ? found.blockHash : null;
  const currentInner = found.status === 'present' ? found.inner : null;
  const issues = [];
  const warnings = [];
  let suggested = null;
  let reason = '';

  if (found.status === 'malformed') {
    issues.push({
      code: 'current-malformed',
      message: `当前入口的工作台块标记异常：${found.reason}；先修正 BEGIN/END 标记各一处，或从备份恢复后再合并。`
    });
    reason = '当前入口的工作台块标记异常，无法安全定位要替换的内容。';
  } else if (found.status === 'present') {
    suggested = replaceBlock(existingText, wrapBlock(workbenchInner, newline));
    reason =
      currentBlockHash === workbenchBlockHash
        ? '现有工作台块已与当前构建一致；可原样保留，或继续编辑块内正文。'
        : '用当前构建替换工作台块；块外原文保持不变。';
  } else if (strategy === 'separate-file' && exists && existingText.trim() !== '') {
    issues.push({
      code: 'existing-non-workbench',
      message: '入口已存在且不是工作台文件，不能覆盖；请先手工处理该文件中的内容。'
    });
    reason = '同名入口已存在且不是工作台文件，未生成合并建议。';
  } else if (strategy === 'separate-file') {
    suggested = composeSeparateFile(frontmatter, workbenchInner);
    reason = exists
      ? '入口文件为空，将写入 frontmatter 与工作台块。'
      : '入口文件不存在，将新建带 frontmatter 的工作台文件。';
  } else if (exists) {
    suggested = appendBlock(existingText, wrapBlock(workbenchInner, newline));
    reason = '文件中没有工作台块，将追加到文件末尾；原有内容保持不变。';
  } else {
    suggested = `${wrapBlock(workbenchInner, '\n')}\n`;
    reason = '入口文件不存在，将新建文件并写入工作台块。';
  }

  const modifiedSinceDeploy = Boolean(
    currentBlockHash && storedBlockHash && currentBlockHash !== storedBlockHash
  );
  if (modifiedSinceDeploy) {
    warnings.push(
      '当前工作台块与部署记录不一致（可能被手工修改）；保存后会用本次合并结果更新部署记录。'
    );
  } else if (currentBlockHash && !storedBlockHash) {
    warnings.push('入口中已有工作台块但没有部署记录；保存后会接管该块。');
  }

  return {
    exists,
    strategy,
    newline,
    blockStatus: found.status,
    blockReason: found.status === 'malformed' ? found.reason : null,
    currentBlockHash,
    currentInner,
    workbenchBlockHash,
    storedBlockHash,
    modifiedSinceDeploy,
    suggested,
    suggestedInner: workbenchInner,
    canApply: suggested !== null && issues.length === 0,
    reason,
    warnings,
    issues
  };
}

/**
 * 校验提交的完整合并结果：只允许改工作台块正文，块外内容必须保持原样。
 * @param {{
 *   existingText: string|null,
 *   mergedText: string,
 *   strategy: 'block-append'|'separate-file',
 *   frontmatter?: string
 * }} options 校验输入
 * @returns {{ok: boolean, issues: Array<{code: string, message: string}>, blockHash: string|null, inner: string|null}} 校验结果
 */
export function validateMergeResult(options) {
  const {
    existingText = null,
    mergedText,
    strategy,
    frontmatter = ''
  } = options;

  assertStrategy(strategy);
  if (typeof mergedText !== 'string') {
    throw new Error('合并结果必须是文本');
  }

  const issues = [];
  const exists = typeof existingText === 'string';
  const current = exists ? findBlock(existingText) : { status: 'absent' };
  const merged = findBlock(mergedText);

  if (merged.status === 'malformed') {
    issues.push({
      code: 'merged-malformed',
      message: `合并结果的工作台块标记异常：${merged.reason}；需要 BEGIN/END 标记各一处且顺序正确。`
    });
  } else if (merged.status === 'absent') {
    issues.push({
      code: 'missing-block',
      message: '合并结果缺少工作台块；BEGIN 与 END 标记各保留一处。'
    });
  } else if (!merged.inner.trim()) {
    issues.push({
      code: 'empty-block',
      message: '工作台块正文不能为空；如需移除工作台内容，请使用 uninstall。'
    });
  }

  if (current.status === 'malformed') {
    issues.push({
      code: 'current-malformed',
      message: `当前入口的工作台块标记异常（${current.reason}），无法安全定位；先修正标记或从备份恢复。`
    });
  }

  if (merged.status !== 'present' || current.status === 'malformed') {
    return validationResult(issues, merged);
  }

  const mergedPrefix = normalizeNewlines(mergedText.slice(0, merged.beginIndex));
  const mergedSuffix = normalizeNewlines(mergedText.slice(merged.endIndex));

  if (current.status === 'present') {
    const currentPrefix = normalizeNewlines(existingText.slice(0, current.beginIndex));
    const currentSuffix = normalizeNewlines(existingText.slice(current.endIndex));

    if (mergedPrefix !== currentPrefix) {
      issues.push({
        code: 'prefix-changed',
        message: '工作台块之前的原文被改动；只有块内正文可以修改，块外内容必须保持原样。'
      });
    }
    if (!acceptableSuffix(currentSuffix, mergedSuffix)) {
      issues.push({
        code: 'suffix-changed',
        message: '工作台块之后的原文被改动；只有块内正文可以修改，块外内容必须保持原样。'
      });
    }
  } else if (exists) {
    const currentText = normalizeNewlines(existingText);
    const prefixOk =
      strategy === 'separate-file'
        ? mergedPrefix.trimEnd() === normalizeNewlines(frontmatter).trimEnd()
        : mergedPrefix === currentText || mergedPrefix === `${currentText}\n`;

    if (!prefixOk) {
      issues.push({
        code: 'prefix-changed',
        message:
          strategy === 'separate-file'
            ? '块前内容必须与 frontmatter 模板一致；只有工作台块正文可以修改。'
            : '工作台块之前的内容必须与现有文件一致；没有工作台块时，块只能追加到文件末尾。'
      });
    }
    if (mergedSuffix.trim() !== '') {
      issues.push({
        code: 'trailing-content',
        message: '工作台块之后只能有换行；现有文件没有工作台块时，块必须位于文件末尾。'
      });
    }
  } else {
    const expectedPrefix =
      strategy === 'separate-file' ? normalizeNewlines(frontmatter).trimEnd() : '';
    if (mergedPrefix.trimEnd() !== expectedPrefix) {
      issues.push({
        code: 'prefix-changed',
        message:
          strategy === 'separate-file'
            ? '新建文件的工作台块之前必须是 frontmatter 模板内容；不要修改或删除。'
            : '新建文件的工作台块之前不能有其他内容。'
      });
    }
    if (mergedSuffix.trim() !== '') {
      issues.push({
        code: 'trailing-content',
        message: '新建文件的工作台块之后只能有换行。'
      });
    }
  }

  return validationResult(issues, merged);
}

/**
 * 从原文件与合并后的块正文重建完整入口，保留块外原文与换行风格。
 * @param {{
 *   existingText: string|null,
 *   inner: string,
 *   strategy: 'block-append'|'separate-file',
 *   frontmatter?: string
 * }} options 重建输入
 * @returns {string} 重建后的入口文本
 */
export function buildMergedEntry(options) {
  const { existingText = null, inner, strategy, frontmatter = '' } = options;

  assertStrategy(strategy);
  if (!String(inner ?? '').trim()) {
    throw new Error('合并结果的工作台块正文不能为空');
  }

  if (existingText === null || existingText === undefined) {
    return createEntry(strategy, inner, frontmatter);
  }

  const found = findBlock(existingText);
  if (found.status === 'malformed') {
    throw new Error(`入口工作台块标记异常：${found.reason}`);
  }
  if (found.status === 'present') {
    return replaceBlock(existingText, wrapBlock(inner, detectNewline(existingText)));
  }
  if (strategy === 'separate-file') {
    if (existingText.trim() !== '') {
      throw new Error('入口已存在且不是工作台文件，不能覆盖');
    }
    return composeSeparateFile(frontmatter, inner);
  }

  return appendBlock(existingText, wrapBlock(inner, detectNewline(existingText)));
}

function validationResult(issues, merged) {
  return {
    ok: issues.length === 0,
    issues,
    blockHash: merged.status === 'present' ? merged.blockHash : null,
    inner: merged.status === 'present' ? merged.inner : null
  };
}

function acceptableSuffix(currentSuffix, mergedSuffix) {
  if (mergedSuffix === currentSuffix) return true;
  if (currentSuffix === '') return mergedSuffix === '\n';
  if (!currentSuffix.startsWith('\n') && mergedSuffix === `\n${currentSuffix}`) return true;
  return false;
}

function createEntry(strategy, inner, frontmatter) {
  return strategy === 'separate-file'
    ? composeSeparateFile(frontmatter, inner)
    : `${wrapBlock(inner, '\n')}\n`;
}

function assertStrategy(strategy) {
  if (strategy !== 'block-append' && strategy !== 'separate-file') {
    throw new Error(`未知入口写入方式：${strategy}`);
  }
}

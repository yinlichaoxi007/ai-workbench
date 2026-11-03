import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MEMORY_BUDGET,
  DEFAULT_MEMORY_MARKERS,
  buildSplitFileContent,
  countChars,
  countTextStats,
  countWords,
  insertMemoryBlock,
  planMemoryBlock,
  removeMemoryBlock,
  splitFileHashOf
} from '../../src/core/lib/memory-block.mjs';
import { wrapBlock } from '../../src/core/lib/merge-engine.mjs';

const SPLIT_PATH = 'C:\\Users\\demo\\.workbuddy\\memory\\ai-workbench-global-rules.md';
const INNER = '# 全局规则\n\n- 公测条目\n';

function plan(overrides = {}) {
  return planMemoryBlock({
    existingText: null,
    workbenchInner: INNER,
    splitFilePath: SPLIT_PATH,
    markers: DEFAULT_MEMORY_MARKERS,
    budget: DEFAULT_MEMORY_BUDGET,
    ...overrides
  });
}

test('字符计数按码点且不归一换行', () => {
  assert.equal(countChars(''), 0);
  assert.equal(countChars('a😀中'), 3);
  assert.equal(countChars('a\r\nb'), 4);
});

test('辅助统计区分空白字符并提供字数估算', () => {
  assert.deepEqual(countTextStats('中 文\nabc'), {
    chars: 7,
    nonWhitespaceChars: 5,
    words: 3
  });
  assert.deepEqual(countTextStats(''), { chars: 0, nonWhitespaceChars: 0, words: 0 });
  assert.equal(countTextStats('中\u3000文').nonWhitespaceChars, 2);
  assert.equal(countWords('中文 abc _x1 😀'), 4);
});

test('顶部与末尾插入都能精确移除并还原原文', () => {
  const original = '# 记忆\n\n- 保留我\n';
  const block = wrapBlock('规则', '\n', DEFAULT_MEMORY_MARKERS);

  const top = insertMemoryBlock(original, block, 'top');
  assert.equal(top, `${block}\n${original}`);
  assert.equal(removeMemoryBlock(top, DEFAULT_MEMORY_MARKERS), original);

  const bottom = insertMemoryBlock(original, block, 'bottom');
  assert.equal(removeMemoryBlock(bottom, DEFAULT_MEMORY_MARKERS), original);
});

test('预算充足时内联规则，不生成拆分文件', () => {
  const result = plan({ existingText: '# 记忆\n' });

  assert.equal(result.action, 'insert-block');
  assert.equal(result.memoryMode, 'inline');
  assert.equal(result.splitAction, 'none');
  assert.equal(result.splitFileContent, null);
  assert.equal(result.nextText, `${result.blockText}\n# 记忆\n`);
  assert.equal(result.blockText.includes('公测条目'), true);
  assert.equal(result.blockChars, countChars(result.blockText));
  assert.equal(result.totalChars, countChars(result.nextText));
  assert.equal(
    result.totalNonWhitespaceChars,
    countTextStats(result.nextText).nonWhitespaceChars
  );
  assert.equal(result.totalWords, countTextStats(result.nextText).words);
  assert.ok(result.totalNonWhitespaceChars < result.totalChars);
});

test('超过目标线时只保留钩子并生成拆分文件', () => {
  const existing = `${'x'.repeat(3400)}\n`;
  const result = plan({ existingText: existing });

  assert.equal(result.memoryMode, 'hook');
  assert.equal(result.splitAction, 'create');
  assert.equal(result.nextText.startsWith(result.blockText), true);
  assert.equal(result.blockText.includes('完整规则见'), true);
  assert.equal(result.blockText.includes(SPLIT_PATH), true);
  assert.ok(result.blockChars <= DEFAULT_MEMORY_BUDGET.blockBudget);
  assert.equal(result.splitFileContent.startsWith('# AI 工作台全局规则\n'), true);
  assert.equal(result.splitFileContent.includes('公测条目'), true);
  assert.equal(result.splitFileHash, splitFileHashOf(result.splitFileContent));
  assert.ok(result.warnings.some((warning) => warning.includes('目标线')));
});

test('超注入上限且置顶时提醒，末尾则阻止', () => {
  const existing = `${'x'.repeat(4000)}\n`;

  const top = plan({ existingText: existing });
  assert.equal(top.action, 'insert-block');
  assert.equal(top.memoryMode, 'hook');
  assert.ok(top.warnings.some((warning) => warning.includes('注入上限')));
  assert.ok(top.warnings.some((warning) => warning.includes('已置顶')));

  const bottom = plan({ existingText: existing, placement: 'bottom' });
  assert.equal(bottom.action, 'manual');
  assert.match(bottom.reason, /注入时/);
});

test('标记重复或顺序错误时阻止写入', () => {
  const duplicate = [
    'a',
    DEFAULT_MEMORY_MARKERS.begin,
    'x',
    DEFAULT_MEMORY_MARKERS.end,
    DEFAULT_MEMORY_MARKERS.begin,
    'y',
    DEFAULT_MEMORY_MARKERS.end
  ].join('\n');
  const duplicated = plan({ existingText: duplicate });
  assert.equal(duplicated.action, 'manual');
  assert.match(duplicated.reason, /标记/);

  const orphan = plan({ existingText: `a\n${DEFAULT_MEMORY_MARKERS.begin}\n` });
  assert.equal(orphan.action, 'manual');
});

test('内联模式清理本工作台生成的拆分文件，保留用户自有文件', () => {
  const splitContent = buildSplitFileContent(INNER);
  const splitHash = splitFileHashOf(splitContent);

  const owned = plan({
    existingText: '# 记忆\n',
    splitFile: { exists: true, text: splitContent, hash: splitHash }
  });
  assert.equal(owned.memoryMode, 'inline');
  assert.equal(owned.splitAction, 'remove');

  const unowned = plan({
    existingText: '# 记忆\n',
    splitFile: { exists: true, text: '用户自己的文件\n', hash: splitFileHashOf('用户自己的文件\n') }
  });
  assert.equal(unowned.splitAction, 'none');
  assert.ok(unowned.warnings.some((warning) => warning.includes('保留不动')));
});

test('已有区块与拆分文件哈希一致时可接管且保持无变化', () => {
  const existing = `${'x'.repeat(3400)}\n`;
  const first = plan({ existingText: existing });
  const splitContent = first.splitFileContent;
  const splitHash = splitFileHashOf(splitContent);

  const adopted = plan({
    existingText: first.nextText,
    splitFile: { exists: true, text: splitContent, hash: splitHash }
  });
  assert.equal(adopted.action, 'unchanged');
  assert.equal(adopted.adopt, true);

  const unchanged = plan({
    existingText: first.nextText,
    storedBlockHash: first.blockHash,
    storedSplitFileHash: splitHash,
    splitFile: { exists: true, text: splitContent, hash: splitHash }
  });
  assert.equal(unchanged.action, 'unchanged');
  assert.equal(unchanged.nextText, null);

  const drifted = plan({
    existingText: first.nextText,
    storedBlockHash: first.blockHash,
    storedSplitFileHash: 'sha256:deadbeef',
    splitFile: { exists: true, text: splitContent, hash: splitHash }
  });
  assert.equal(drifted.action, 'manual');
  assert.match(drifted.reason, /拆分文件与部署记录不一致/);
});

test('内容更新时重写区块与拆分文件', () => {
  const existing = `${'x'.repeat(3400)}\n`;
  const first = plan({ existingText: existing });
  const splitHash = splitFileHashOf(first.splitFileContent);
  const nextInner = '# 全局规则\n\n- 新条目\n';

  const updated = plan({
    existingText: first.nextText,
    workbenchInner: nextInner,
    storedBlockHash: first.blockHash,
    storedSplitFileHash: splitHash,
    splitFile: { exists: true, text: first.splitFileContent, hash: splitHash }
  });

  assert.equal(updated.action, 'update-block');
  assert.equal(updated.splitAction, 'update');
  assert.equal(updated.splitFileContent.includes('新条目'), true);
  assert.equal(updated.nextText.includes('新条目'), false);
  assert.equal(updated.nextText.includes('完整规则见'), true);
});

test('拆分文件内容异常时阻止覆盖', () => {
  const existing = `${'x'.repeat(3400)}\n`;
  const foreign = { exists: true, text: '别人的内容\n', hash: splitFileHashOf('别人的内容\n') };

  const unrecorded = plan({ existingText: existing, splitFile: foreign });
  assert.equal(unrecorded.action, 'manual');
  assert.match(unrecorded.reason, /拆分文件已存在/);

  const unreadable = plan({
    existingText: existing,
    splitFile: { exists: true, text: null, hash: 'sha256:deadbeef' }
  });
  assert.equal(unreadable.action, 'manual');
  assert.match(unreadable.reason, /UTF-8/);
});

test('空内容与非法预算直接报错', () => {
  assert.throws(() => plan({ workbenchInner: '   ' }), /工作台内容为空/);
  assert.throws(
    () => plan({ budget: { injectLimit: 100, targetLimit: 200, blockBudget: 600 } }),
    /targetLimit 不能大于 injectLimit/
  );
  assert.throws(() => plan({ budget: { blockBudget: 0 } }), /blockBudget/);
});

test('已有 CRLF 文件沿用 CRLF，拆分文件固定 LF', () => {
  const existing = '# 记忆\r\n\r\n- 一条\r\n';
  const result = plan({ existingText: existing });

  assert.equal(result.blockText.includes('\r\n'), true);
  assert.equal(/(^|[^\r])\n/.test(result.nextText), false);
  assert.equal(result.nextText.includes('公测条目'), true);
  assert.equal(buildSplitFileContent(INNER).includes('\r'), false);
});

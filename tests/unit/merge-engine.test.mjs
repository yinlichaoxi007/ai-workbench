import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEGIN_MARKER,
  appendBlock,
  composeSeparateFile,
  findBlock,
  planBlockMerge,
  planSeparateFile,
  removeBlock,
  replaceBlock,
  wrapBlock
} from '../../src/core/lib/merge-engine.mjs';

test('查找工作台块：不存在、完整、损坏', () => {
  assert.equal(findBlock('# 项目规则\n').status, 'absent');

  const text = `前缀\n${wrapBlock('入口内容')}\n后缀\n`;
  const found = findBlock(text);
  assert.equal(found.status, 'present');
  assert.equal(found.inner, '入口内容');
  assert.equal(found.blockHash.startsWith('sha256:'), true);

  assert.equal(findBlock(`${BEGIN_MARKER}\n没有结束标记\n`).status, 'malformed');
  assert.equal(findBlock(`${BEGIN_MARKER}\n一\n${BEGIN_MARKER}\n${'<!-- AI-WORKBENCH:END -->'}\n`).status, 'malformed');
});

test('文件没有工作台块时只追加，不改动原内容', () => {
  const existing = '# 项目规则\n\n- 保留我\n- 不要覆盖\n';
  const plan = planBlockMerge({ existingText: existing, newInner: '工作台入口' });

  assert.equal(plan.action, 'append-block');
  const merged = appendBlock(existing, plan.blockText);
  assert.ok(merged.startsWith(existing));
  assert.ok(merged.includes('保留我'));
  assert.ok(merged.includes('工作台入口'));
  assert.equal(findBlock(merged).status, 'present');
});

test('内容版本一致时保持不动', () => {
  const existing = `${wrapBlock('旧入口')}\n`;
  const storedBlockHash = findBlock(existing).blockHash;
  const plan = planBlockMerge({
    existingText: existing,
    newInner: '新入口（仅生成时间不同）',
    storedBlockHash,
    contentUnchanged: true
  });

  assert.equal(plan.action, 'unchanged');
  assert.equal(plan.adopt, undefined);
});

test('内容更新时只替换块，保留前后文', () => {
  const existing = `项目说明\n\n${wrapBlock('旧入口')}\n\n尾部规则\n`;
  const storedBlockHash = findBlock(existing).blockHash;
  const plan = planBlockMerge({
    existingText: existing,
    newInner: '新入口',
    storedBlockHash
  });

  assert.equal(plan.action, 'update-block');
  const updated = replaceBlock(existing, plan.replacement);
  assert.ok(updated.startsWith('项目说明'));
  assert.ok(updated.includes('尾部规则'));
  assert.ok(updated.includes('新入口'));
  assert.equal(updated.includes('旧入口'), false);
  assert.equal(findBlock(updated).blockHash, plan.blockHash);
});

test('块被手工修改时停下', () => {
  const existing = `${wrapBlock('被手改的入口')}\n`;
  const plan = planBlockMerge({
    existingText: existing,
    newInner: '新入口',
    storedBlockHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
  });

  assert.equal(plan.action, 'manual');
  assert.match(plan.reason, /手工修改/);
});

test('没有状态记录但块内容一致时可以接管', () => {
  const existing = `${wrapBlock('入口内容')}\n`;
  const plan = planBlockMerge({ existingText: existing, newInner: '入口内容' });

  assert.equal(plan.action, 'unchanged');
  assert.equal(plan.adopt, true);
});

test('独立文件：不存在时创建并带 frontmatter', () => {
  const plan = planSeparateFile({
    existingText: null,
    newInner: '入口内容',
    frontmatter: '---\ndescription: test\n---'
  });

  assert.equal(plan.action, 'create-file');
  assert.ok(plan.fileContent.startsWith('---\ndescription: test\n---'));
  assert.ok(plan.fileContent.includes('入口内容'));
  assert.equal(findBlock(plan.fileContent).status, 'present');
});

test('独立文件：已有非工作台内容时只报告', () => {
  const plan = planSeparateFile({
    existingText: '# 用户自己的全局规则\n',
    newInner: '入口内容'
  });

  assert.equal(plan.action, 'manual');
  assert.match(plan.reason, /不能覆盖/);
});

test('追加块时保留 CRLF 换行', () => {
  const existing = '项目规则\r\n';
  const plan = planBlockMerge({ existingText: existing, newInner: '入口内容' });

  assert.equal(plan.action, 'append-block');
  assert.ok(plan.blockText.includes('\r\n'));
  assert.equal(/[^\r]\n/.test(plan.blockText), false);
});

test('块位于文件末尾时补回原换行风格', () => {
  const existing = `项目规则\r\n${wrapBlock('旧入口', '\r\n')}`;
  const storedBlockHash = findBlock(existing).blockHash;
  const plan = planBlockMerge({ existingText: existing, newInner: '新入口', storedBlockHash });
  const updated = replaceBlock(existing, plan.replacement);

  assert.ok(updated.endsWith('\r\n'));
  assert.equal(/[^\r]\n/.test(updated), false);
});

test('移除工作台块时保留块外内容与换行', () => {
  const existing = '# 用户规则\n\n- 保留我\n';
  const merged = appendBlock(existing, wrapBlock('入口内容'));
  assert.equal(removeBlock(merged), existing);

  assert.equal(removeBlock(`${wrapBlock('入口内容')}\n`), '');
  assert.equal(removeBlock(`前缀\r\n${wrapBlock('入口内容', '\r\n')}\r\n`), '前缀\r\n');
  assert.throws(() => removeBlock('没有工作台块\n'), /没有可移除/);
});

test('组合独立文件时 frontmatter 位于块之前', () => {
  const content = composeSeparateFile('---\nname: demo\n---', '入口内容');
  assert.ok(content.startsWith('---\nname: demo\n---'));
  assert.ok(content.indexOf(BEGIN_MARKER) > content.indexOf('---\nname: demo\n---'));
});

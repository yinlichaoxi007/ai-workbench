import test from 'node:test';
import assert from 'node:assert/strict';
import { findBlock, wrapBlock } from '../../src/core/lib/merge-engine.mjs';
import {
  buildMergedEntry,
  planEntryMerge,
  validateMergeResult
} from '../../src/core/lib/merge-entry.mjs';

test('没有工作台块时追加，建议结果通过校验且保留前缀', () => {
  const existing = '# 用户规则\n\n- 保留我\n';
  const plan = planEntryMerge({
    existingText: existing,
    workbenchInner: '工作台入口',
    strategy: 'block-append'
  });

  assert.equal(plan.blockStatus, 'absent');
  assert.equal(plan.canApply, true);
  assert.ok(plan.suggested.startsWith(existing));
  assert.equal(plan.suggested.indexOf('工作台入口') > plan.suggested.indexOf(existing), true);

  const validation = validateMergeResult({
    existingText: existing,
    mergedText: plan.suggested,
    strategy: 'block-append'
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.inner, '工作台入口');
  assert.equal(validation.blockHash, findBlock(plan.suggested).blockHash);
});

test('已有工作台块时只替换块内正文，块外改动被拒绝', () => {
  const existing = `项目说明\n\n${wrapBlock('旧入口')}\n\n尾部规则\n`;
  const plan = planEntryMerge({
    existingText: existing,
    workbenchInner: '新入口',
    strategy: 'block-append'
  });

  assert.equal(plan.blockStatus, 'present');
  assert.ok(plan.suggested.startsWith('项目说明\n\n'));
  assert.ok(plan.suggested.includes('尾部规则'));
  assert.ok(plan.suggested.includes('新入口'));
  assert.equal(plan.suggested.includes('旧入口'), false);

  const prefixEdit = plan.suggested.replace('项目说明', '项目说明（改）');
  const prefixResult = validateMergeResult({
    existingText: existing,
    mergedText: prefixEdit,
    strategy: 'block-append'
  });
  assert.equal(prefixResult.ok, false);
  assert.equal(prefixResult.issues.some((issue) => issue.code === 'prefix-changed'), true);

  const suffixEdit = plan.suggested.replace('尾部规则', '尾部规则（改）');
  const suffixResult = validateMergeResult({
    existingText: existing,
    mergedText: suffixEdit,
    strategy: 'block-append'
  });
  assert.equal(suffixResult.ok, false);
  assert.equal(suffixResult.issues.some((issue) => issue.code === 'suffix-changed'), true);

  const normal = validateMergeResult({
    existingText: existing,
    mergedText: plan.suggested,
    strategy: 'block-append'
  });
  assert.equal(normal.ok, true);
});

test('块位于文件末尾时允许补一个结尾换行', () => {
  const existing = `项目说明\n${wrapBlock('旧入口')}`;
  const plan = planEntryMerge({
    existingText: existing,
    workbenchInner: '新入口',
    strategy: 'block-append'
  });

  assert.equal(plan.suggested.endsWith('\n'), true);
  assert.equal(
    validateMergeResult({
      existingText: existing,
      mergedText: plan.suggested,
      strategy: 'block-append'
    }).ok,
    true
  );
});

test('空块、缺标记与当前块损坏都会被拒绝', () => {
  const existing = `前缀\n${wrapBlock('旧入口')}\n`;
  const empty = validateMergeResult({
    existingText: existing,
    mergedText: '前缀\n<!-- AI-WORKBENCH:BEGIN -->\n   \n<!-- AI-WORKBENCH:END -->\n',
    strategy: 'block-append'
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.issues.some((issue) => issue.code === 'empty-block'), true);

  const missing = validateMergeResult({
    existingText: existing,
    mergedText: '前缀\n没有块\n',
    strategy: 'block-append'
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.issues.some((issue) => issue.code === 'missing-block'), true);

  const broken = '前缀\n<!-- AI-WORKBENCH:BEGIN -->\n没有结束\n';
  const plan = planEntryMerge({
    existingText: broken,
    workbenchInner: '入口',
    strategy: 'block-append'
  });
  assert.equal(plan.canApply, false);
  assert.equal(plan.suggested, null);
  assert.equal(plan.issues.some((issue) => issue.code === 'current-malformed'), true);
});

test('没有工作台块时，块后不能还有正文', () => {
  const existing = '# 用户规则\n';
  const plan = planEntryMerge({
    existingText: existing,
    workbenchInner: '入口',
    strategy: 'block-append'
  });
  const tail = `${plan.suggested}\n额外正文\n`;
  const result = validateMergeResult({
    existingText: existing,
    mergedText: tail,
    strategy: 'block-append'
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'trailing-content'), true);
});

test('独立文件新建时保留 frontmatter，修改 frontmatter 被拒绝', () => {
  const frontmatter = '---\ndescription: 工作台规则\n---';
  const plan = planEntryMerge({
    existingText: null,
    workbenchInner: '入口内容',
    strategy: 'separate-file',
    frontmatter
  });

  assert.equal(plan.canApply, true);
  assert.ok(plan.suggested.startsWith(frontmatter));
  assert.equal(
    validateMergeResult({
      existingText: null,
      mergedText: plan.suggested,
      strategy: 'separate-file',
      frontmatter
    }).ok,
    true
  );

  const edited = plan.suggested.replace('description: 工作台规则', 'description: 我改的');
  const result = validateMergeResult({
    existingText: null,
    mergedText: edited,
    strategy: 'separate-file',
    frontmatter
  });
  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'prefix-changed'), true);
});

test('独立文件已有用户内容时阻止合并', () => {
  const plan = planEntryMerge({
    existingText: '# 用户自己的规则\n',
    workbenchInner: '入口内容',
    strategy: 'separate-file'
  });

  assert.equal(plan.canApply, false);
  assert.equal(plan.suggested, null);
  assert.equal(plan.issues.some((issue) => issue.code === 'existing-non-workbench'), true);
  assert.throws(
    () =>
      buildMergedEntry({
        existingText: '# 用户自己的规则\n',
        inner: '入口内容',
        strategy: 'separate-file'
      }),
    /不能覆盖/
  );
});

test('独立文件为空时按 frontmatter 新建', () => {
  const frontmatter = '---\nname: demo\n---';
  const plan = planEntryMerge({
    existingText: '',
    workbenchInner: '入口内容',
    strategy: 'separate-file',
    frontmatter
  });

  assert.equal(plan.canApply, true);
  assert.ok(plan.suggested.startsWith(frontmatter));
  assert.equal(
    buildMergedEntry({
      existingText: '',
      inner: '入口内容',
      strategy: 'separate-file',
      frontmatter
    }),
    plan.suggested
  );
});

test('重建时保留 CRLF，不混入单个 LF', () => {
  const existing = '# 用户规则\r\n\r\n- 保留我\r\n';
  const plan = planEntryMerge({
    existingText: existing,
    workbenchInner: '入口内容',
    strategy: 'block-append'
  });

  assert.equal(/[^\r]\n/.test(plan.suggested), false);
  const built = buildMergedEntry({
    existingText: existing,
    inner: '手工合并正文',
    strategy: 'block-append'
  });
  assert.ok(built.startsWith(existing));
  assert.equal(/[^\r]\n/.test(built), false);
});

test('重建结果与建议结果在块外保持一致', () => {
  const existing = '前缀\n\n' + wrapBlock('旧入口') + '\n\n后缀\n';
  const plan = planEntryMerge({
    existingText: existing,
    workbenchInner: '新入口',
    strategy: 'block-append'
  });
  const found = findBlock(plan.suggested);
  const built = buildMergedEntry({
    existingText: existing,
    inner: '手工合并正文',
    strategy: 'block-append'
  });
  const builtBlock = findBlock(built);

  assert.equal(
    plan.suggested.slice(0, found.beginIndex),
    built.slice(0, builtBlock.beginIndex)
  );
  assert.equal(
    plan.suggested.slice(found.endIndex),
    built.slice(builtBlock.endIndex)
  );
});

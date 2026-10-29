import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEntry } from '../../src/core/lib/entry-builder.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('生成入口内容并注入机器路径', () => {
  const built = buildEntry(repoRoot, {
    now: new Date(2026, 9, 26, 12, 0, 0),
    hostname: '<主机名>'
  });

  assert.match(built.content, /^<!-- 由 ai-workbench 生成/);
  assert.match(built.content, /## 必须遵守/);
  assert.match(built.content, /项目父级：X:\projects/);
  assert.match(built.content, /工作参考资料：X:\references/);
  assert.match(built.content, /content[\\/]rules[\\/]00-index\.md/);
  assert.match(built.content, /aiwb（内置）/);
  assert.equal(built.skills.some((skill) => skill.name === 'aiwb' && skill.builtin), true);
  assert.equal(built.content.includes('{{'), false);
  assert.equal(built.content.endsWith('\n'), true);
  assert.equal(built.contentHash.startsWith('sha256:'), true);
  assert.equal(built.blockHash.startsWith('sha256:'), true);
  assert.equal(built.machine.host, '<主机名>');
});

test('源内容不变时内容哈希稳定，生成时间变化只影响块哈希', () => {
  const first = buildEntry(repoRoot, {
    now: new Date(2026, 9, 26, 12, 0, 0),
    hostname: '<主机名>'
  });
  const second = buildEntry(repoRoot, {
    now: new Date(2026, 9, 26, 12, 5, 0),
    hostname: '<主机名>'
  });

  assert.equal(first.contentHash, second.contentHash);
  assert.notEqual(first.blockHash, second.blockHash);
});

test('构建清单登记规则、模板、机器档案和版本', () => {
  const built = buildEntry(repoRoot, {
    now: new Date(2026, 9, 26, 12, 0, 0),
    hostname: '<主机名>'
  });
  const sourcePaths = built.sources.map((source) => source.path);

  assert.ok(sourcePaths.includes('VERSION'));
  assert.ok(sourcePaths.includes('machines/<主机名>.md'));
  assert.ok(sourcePaths.includes('content/rules/02-workflow.md'));
  assert.ok(sourcePaths.includes('content/templates/entry-index.md'));
  assert.equal(built.manifest.contentHash, built.contentHash);
  assert.equal(built.manifest.blockHash, built.blockHash);
});

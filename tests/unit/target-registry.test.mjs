import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTargets } from '../../src/core/lib/target-registry.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('加载全部目标并展开 home 路径', () => {
  const tools = loadTargets(repoRoot);

  assert.equal(tools.length, 7);
  assert.deepEqual(
    tools.map((tool) => tool.id),
    ['qoder-cn', 'trae-cn', 'codebuddy', 'qwenwork-cn', 'workbuddy', 'claude-code', 'codex']
  );

  const qoder = tools.find((tool) => tool.id === 'qoder-cn');
  assert.equal(qoder.enabled, true);
  assert.equal(qoder.installed, true);
  assert.equal(qoder.entryPath.includes('~'), false);
  assert.match(qoder.entryPath, /\.qoder-cn[\\/]AGENTS\.md$/);
});

test('预留工具不参与部署', () => {
  const tools = loadTargets(repoRoot);
  const claude = tools.find((tool) => tool.id === 'claude-code');
  const codex = tools.find((tool) => tool.id === 'codex');

  assert.equal(claude.enabled, false);
  assert.equal(claude.installed, false);
  assert.equal(codex.enabled, false);
  assert.equal(codex.installed, false);
});

test('CodeBuddy 使用独立 mdc 文件和 frontmatter 模板', () => {
  const tools = loadTargets(repoRoot);
  const codebuddy = tools.find((tool) => tool.id === 'codebuddy');

  assert.equal(codebuddy.entry.strategy, 'separate-file');
  assert.equal(codebuddy.entry.format, 'mdc');
  assert.equal(fs.existsSync(codebuddy.frontmatterTemplate), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTargets } from '../../src/core/lib/target-registry.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = 'TEST-HOST';

function makeSandbox(t, customTools) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-targets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'adapters'), { recursive: true });
  fs.mkdirSync(path.join(root, 'machines'), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, 'adapters', 'targets.json'),
    path.join(root, 'adapters', 'targets.json')
  );
  const text = [
    '---',
    `host: ${HOST}`,
    '---',
    '',
    '## 路径',
    '',
    '- 全局工作台：X:\\aiwb',
    '',
    '## 设置',
    '',
    '```json',
    JSON.stringify({ customTools }, null, 2),
    '```'
  ].join('\n');
  fs.writeFileSync(path.join(root, 'machines', `${HOST}.md`), text, 'utf8');
  return root;
}

function customTool(root, overrides = {}) {
  const configRoot = path.join(root, 'custom-tool');
  return {
    name: 'My Tool',
    configRoot,
    entryPath: path.join(configRoot, 'AGENTS.md'),
    strategy: 'block-append',
    format: 'markdown',
    ...overrides
  };
}

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

test('自定义工具并入目标列表，配置目录不存在也可解析', (t) => {
  const skillsDir = path.join(os.tmpdir(), 'aiwb-unused', 'skills');
  const root = makeSandbox(t, {
    'my-tool': customTool(path.join(os.tmpdir(), 'aiwb-unused'), {
      strategy: 'separate-file',
      format: 'mdc',
      skillsDir,
      frontmatter: '---\ndescription: demo\n---',
      enabled: true
    })
  });
  const tools = loadTargets(root, { hostname: HOST });
  const custom = tools.find((tool) => tool.id === 'my-tool');

  assert.equal(tools.length, 8);
  assert.ok(custom);
  assert.equal(custom.custom, true);
  assert.equal(custom.status, 'unverified');
  assert.equal(custom.enabled, true);
  assert.equal(custom.installed, false);
  assert.equal(custom.configRootExists, false);
  assert.equal(custom.entryExists, false);
  assert.equal(custom.usingFallback, false);
  assert.equal(custom.entry.strategy, 'separate-file');
  assert.equal(custom.entry.format, 'mdc');
  assert.equal(custom.frontmatter, '---\ndescription: demo\n---');
  assert.equal(custom.skillsDir, skillsDir);
  assert.equal(custom.skillsDirExists, false);
  assert.equal(custom.overrides.enabled, null);
});

test('自定义工具 id 冲突、无效字段与解析问题阻止加载', (t) => {
  const collisionRoot = makeSandbox(t, { 'qoder-cn': customTool(path.join(os.tmpdir(), 'collision')) });
  assert.throws(
    () => loadTargets(collisionRoot, { hostname: HOST }),
    /自定义工具 id 与内置目标重复：qoder-cn/
  );

  const strategyRoot = makeSandbox(t, {
    'bad-tool': customTool(path.join(os.tmpdir(), 'strategy'), { strategy: 'other' })
  });
  assert.throws(
    () => loadTargets(strategyRoot, { hostname: HOST }),
    /customTools\.bad-tool\.strategy 只能是 block-append 或 separate-file/
  );

  const relativeRoot = makeSandbox(t, {
    'relative-tool': customTool(path.join(os.tmpdir(), 'relative'), {
      entryPath: 'relative\\AGENTS.md'
    })
  });
  assert.throws(
    () => loadTargets(relativeRoot, { hostname: HOST }),
    /entryPath 必须是绝对路径/
  );

  const invalidRoot = makeSandbox(t, { 'Bad ID': customTool(path.join(os.tmpdir(), 'invalid')) });
  assert.throws(
    () => loadTargets(invalidRoot, { hostname: HOST }),
    /自定义工具设置存在问题/
  );
});

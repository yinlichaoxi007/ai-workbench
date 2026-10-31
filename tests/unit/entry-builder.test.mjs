import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEntry } from '../../src/core/lib/entry-builder.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = 'TEST-HOST';

const MACHINE_TEXT = [
  '---',
  'host: TEST-HOST',
  'backupRetention: 7',
  'guiPort: 0',
  '---',
  '',
  '# TEST-HOST 机器档案',
  '',
  '## 路径',
  '',
  '- 项目父级：X:\\projects',
  '- 全局工作台：X:\\aiwb',
  '- 工作参考资料：X:\\references',
  '- 工作计划总结：X:\\reports',
  '- 桌面交付：X:\\desktop',
  '',
  '## 项目清单',
  '',
  '| 名称 | 路径 | 技术栈 | 构建/测试 | 备注 |',
  '|---|---|---|---|---|',
  '| demo | X:\\projects\\demo | Node.js | npm test | 示例 |'
].join('\n');

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(repoRoot, 'content'), path.join(root, 'content'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'VERSION'), path.join(root, 'VERSION'));
  fs.mkdirSync(path.join(root, 'machines'), { recursive: true });
  fs.writeFileSync(path.join(root, 'machines', `${HOST}.md`), MACHINE_TEXT, 'utf8');
  return root;
}

function buildAt(root, now) {
  return buildEntry(root, { now, hostname: HOST });
}

test('生成入口内容并注入机器路径', (t) => {
  const root = makeRepo(t);
  const built = buildAt(root, new Date(2026, 9, 26, 12, 0, 0));

  assert.match(built.content, /^<!-- 由 ai-workbench 生成/);
  assert.match(built.content, /## 必须遵守/);
  assert.match(built.content, /项目父级：X:\\projects/);
  assert.match(built.content, /全局工作台：X:\\aiwb/);
  assert.match(built.content, /工作参考资料：X:\\references/);
  assert.match(built.content, /工作计划总结：X:\\reports/);
  assert.match(built.content, /content[\\/]rules[\\/]00-index\.md/);
  assert.match(built.content, /aiwb（内置）/);
  assert.equal(built.skills.some((skill) => skill.name === 'aiwb' && skill.builtin), true);
  assert.equal(built.content.includes('{{'), false);
  assert.equal(built.content.endsWith('\n'), true);
  assert.equal(built.contentHash.startsWith('sha256:'), true);
  assert.equal(built.blockHash.startsWith('sha256:'), true);
  assert.equal(built.machine.host, HOST);
});

test('源内容不变时内容哈希稳定，生成时间变化只影响块哈希', (t) => {
  const root = makeRepo(t);
  const first = buildAt(root, new Date(2026, 9, 26, 12, 0, 0));
  const second = buildAt(root, new Date(2026, 9, 26, 12, 5, 0));

  assert.equal(first.contentHash, second.contentHash);
  assert.notEqual(first.blockHash, second.blockHash);
});

test('机器档案缺少全局工作台时报错', (t) => {
  const root = makeRepo(t);
  const withoutGlobal = MACHINE_TEXT.split('\n')
    .filter((line) => !line.startsWith('- 全局工作台：'))
    .join('\n');
  fs.writeFileSync(path.join(root, 'machines', `${HOST}.md`), withoutGlobal, 'utf8');

  assert.throws(
    () => buildAt(root, new Date(2026, 9, 26, 12, 0, 0)),
    /缺少“全局工作台”/
  );
});

test('构建清单登记规则、模板、机器档案和版本', (t) => {
  const root = makeRepo(t);
  const built = buildAt(root, new Date(2026, 9, 26, 12, 0, 0));
  const sourcePaths = built.sources.map((source) => source.path);

  assert.ok(sourcePaths.includes('VERSION'));
  assert.ok(sourcePaths.includes(`machines/${HOST}.md`));
  assert.ok(sourcePaths.includes('content/rules/02-workflow.md'));
  assert.ok(sourcePaths.includes('content/templates/entry-index.md'));
  assert.equal(built.manifest.contentHash, built.contentHash);
  assert.equal(built.manifest.blockHash, built.blockHash);
});

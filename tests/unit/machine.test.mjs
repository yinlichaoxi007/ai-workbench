import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadMachine } from '../../src/core/lib/machine.mjs';

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
  '- 工作参考资料：X:\\references',
  '- 桌面交付：X:\\desktop',
  '',
  '## 项目清单',
  '',
  '| 名称 | 路径 | 技术栈 | 构建/测试 | 备注 |',
  '|---|---|---|---|---|',
  '| demo | X:\\projects\\demo | Node.js | npm test | 示例 |',
  '| tool | X:\\projects\\tool | Node.js | npm test | 示例 |'
].join('\n');

function makeRepo(t, hostname = 'TEST-HOST') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-machine-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'machines'), { recursive: true });
  fs.writeFileSync(path.join(root, 'machines', `${hostname}.md`), MACHINE_TEXT, 'utf8');
  return root;
}

test('读取机器档案并解析路径与项目', (t) => {
  const root = makeRepo(t);
  const machine = loadMachine(root, 'TEST-HOST');

  assert.equal(machine.host, 'TEST-HOST');
  assert.equal(machine.meta.backupRetention, 7);
  assert.equal(machine.paths['项目父级'], 'X:\\projects');
  assert.equal(machine.paths['工作参考资料'], 'X:\\references');
  assert.equal(machine.projects.length, 2);
  assert.equal(machine.projects[0].名称, 'demo');
  assert.match(machine.filePath, /machines[\\/]TEST-HOST\.md$/);
});

test('机器档案不存在时给出可操作错误', (t) => {
  const root = makeRepo(t);
  assert.throws(() => loadMachine(root, 'NOT-A-REAL-HOST'), /找不到机器档案/);
});

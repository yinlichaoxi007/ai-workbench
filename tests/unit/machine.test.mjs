import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMachine } from '../../src/core/lib/machine.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('读取 <主机名> 机器档案', () => {
  const machine = loadMachine(repoRoot, '<主机名>');

  assert.equal(machine.host, '<主机名>');
  assert.equal(machine.meta.backupRetention, 10);
  assert.equal(machine.paths['项目父级'], 'X:\projects');
  assert.equal(machine.paths['工作参考资料'], 'X:\references');
  assert.equal(machine.paths['桌面交付'], 'X:\desktop');
  assert.equal(machine.projects.length >= 1, true);
  assert.match(machine.filePath, /machines[\\/]<主机名>\.md$/);
});

test('机器档案不存在时给出可操作错误', () => {
  assert.throws(() => loadMachine(repoRoot, 'NOT-A-REAL-HOST'), /找不到机器档案/);
});

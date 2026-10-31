import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLock, deployLockPath } from '../../src/core/lib/lock.mjs';
import { formatLocalIso } from '../../src/core/lib/time.mjs';

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('获取锁后拒绝第二个持有者，释放后可重新获取', (t) => {
  const repo = makeRepo(t);
  const now = new Date(2026, 9, 31, 15, 0, 0);
  const lock = acquireLock(repo, { now });

  assert.throws(() => acquireLock(repo, { now }), /部署锁已被占用/);
  assert.equal(lock.release(), true);
  assert.equal(fs.existsSync(deployLockPath(repo)), false);

  const again = acquireLock(repo, { now });
  assert.equal(again.release(), true);
});

test('陈旧锁可以接管', (t) => {
  const repo = makeRepo(t);
  const now = new Date(2026, 9, 31, 15, 0, 0);
  const lockPath = deployLockPath(repo);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      token: 'stale-token',
      pid: 1,
      acquiredAt: formatLocalIso(new Date(now.getTime() - 40 * 60 * 1000))
    }),
    'utf8'
  );

  const lock = acquireLock(repo, { now });
  const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.notEqual(current.token, 'stale-token');
  assert.equal(lock.release(), true);
});

test('令牌不匹配时不删除他人的锁', (t) => {
  const repo = makeRepo(t);
  const now = new Date(2026, 9, 31, 15, 0, 0);
  const lock = acquireLock(repo, { now });
  const lockPath = deployLockPath(repo);

  assert.equal(lock.release(), true);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({ token: 'other', pid: 2 }), 'utf8');
  assert.equal(lock.release(), false);
  assert.equal(fs.existsSync(lockPath), true);
});

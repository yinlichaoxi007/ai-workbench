import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyTargetPlan, isWritableAction } from '../../src/core/lib/deploy-writer.mjs';
import { sha256 } from '../../src/core/lib/hash.mjs';
import {
  findBlock,
  planBlockMerge,
  planSeparateFile
} from '../../src/core/lib/merge-engine.mjs';

function makeWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-writer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    repo: root,
    entryPath: path.join(root, 'home', 'AGENTS.md'),
    target: { id: 'demo', entryPath: path.join(root, 'home', 'AGENTS.md') }
  };
}

function writeExisting(entryPath, text) {
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.writeFileSync(entryPath, text, 'utf8');
}

function withFileHash(entryPath, plan) {
  plan.fileHash = sha256(fs.readFileSync(entryPath));
  return plan;
}

test('可写动作集合只包含新建、追加和更新', () => {
  for (const action of ['create-file', 'append-block', 'update-block']) {
    assert.equal(isWritableAction(action), true, action);
  }
  for (const action of ['unchanged', 'manual', 'skip-disabled']) {
    assert.equal(isWritableAction(action), false, action);
  }
});

test('新建块文件：写入标记块并返回文件哈希', (t) => {
  const { repo, entryPath, target } = makeWorkspace(t);
  const plan = planBlockMerge({ existingText: null, newInner: '# 入口\n\n正文\n' });
  const result = applyTargetPlan({ repoRoot: repo, target, plan });

  assert.equal(result.status, 'written');
  assert.equal(result.backup, null);
  assert.equal(result.adopted, false);

  const text = fs.readFileSync(entryPath, 'utf8');
  assert.equal(findBlock(text).status, 'present');
  assert.equal(findBlock(text).blockHash, plan.blockHash);
  assert.equal(result.fileHash, sha256(fs.readFileSync(entryPath)));
  assert.equal(fs.existsSync(path.join(repo, 'state', 'backups')), false);
});

test('追加块：保留原内容，写前备份并记录原哈希', (t) => {
  const { repo, entryPath, target } = makeWorkspace(t);
  const existing = '# 用户规则\n\n- 保留我\n';
  writeExisting(entryPath, existing);
  const originalHash = sha256(fs.readFileSync(entryPath));

  const plan = withFileHash(
    entryPath,
    planBlockMerge({ existingText: existing, newInner: '工作台入口\n' })
  );
  const result = applyTargetPlan({ repoRoot: repo, target, plan });

  assert.equal(result.status, 'written');
  assert.ok(fs.readFileSync(entryPath, 'utf8').startsWith(existing));
  assert.match(result.backup, /state\/backups\/demo\//);

  const backupDir = path.join(repo, result.backup);
  assert.equal(fs.readFileSync(path.join(backupDir, 'AGENTS.md'), 'utf8'), existing);
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.originalHash, originalHash);
  assert.equal(manifest.action, 'append-block');
  assert.equal(manifest.existed, true);
});

test('更新块：只替换块内内容，前后文和备份保持不变', (t) => {
  const { repo, entryPath, target } = makeWorkspace(t);
  const existing = '# 用户规则\n\n- 保留我\n';
  writeExisting(entryPath, existing);

  const createPlan = withFileHash(
    entryPath,
    planBlockMerge({ existingText: existing, newInner: '旧入口\n' })
  );
  applyTargetPlan({ repoRoot: repo, target, plan: createPlan });

  const afterCreate = fs.readFileSync(entryPath, 'utf8');
  const storedBlockHash = findBlock(afterCreate).blockHash;
  const updatePlan = withFileHash(
    entryPath,
    planBlockMerge({
      existingText: afterCreate,
      newInner: '新入口\n',
      storedBlockHash
    })
  );
  assert.equal(updatePlan.action, 'update-block');

  applyTargetPlan({ repoRoot: repo, target, plan: updatePlan });
  const updated = fs.readFileSync(entryPath, 'utf8');

  assert.ok(updated.startsWith(existing));
  assert.equal(updated.includes('旧入口'), false);
  assert.equal(updated.includes('新入口'), true);
  assert.equal(findBlock(updated).blockHash, updatePlan.blockHash);
});

test('独立文件：新建时写入 frontmatter 与工作台块', (t) => {
  const { repo, entryPath, target } = makeWorkspace(t);
  const plan = planSeparateFile({
    existingText: null,
    newInner: '入口正文\n',
    frontmatter: '---\ndescription: 测试\n---'
  });

  applyTargetPlan({ repoRoot: repo, target, plan });
  const text = fs.readFileSync(entryPath, 'utf8');

  assert.ok(text.startsWith('---\ndescription: 测试\n---'));
  assert.equal(findBlock(text).blockHash, plan.blockHash);
});

test('预演后文件被改动时拒绝写入', (t) => {
  const { repo, entryPath, target } = makeWorkspace(t);
  const existing = '用户内容\n';
  writeExisting(entryPath, existing);

  const plan = withFileHash(
    entryPath,
    planBlockMerge({ existingText: existing, newInner: '入口\n' })
  );
  fs.writeFileSync(entryPath, '预演后被改的内容\n', 'utf8');

  assert.throws(
    () => applyTargetPlan({ repoRoot: repo, target, plan }),
    /预演后发生变化/
  );
  assert.equal(fs.readFileSync(entryPath, 'utf8'), '预演后被改的内容\n');
  assert.equal(fs.existsSync(path.join(repo, 'state', 'backups')), false);
});

test('写后校验失败时用备份恢复原文件', (t) => {
  const { repo, entryPath, target } = makeWorkspace(t);
  const existing = '用户内容\n';
  writeExisting(entryPath, existing);

  const plan = withFileHash(
    entryPath,
    planBlockMerge({ existingText: existing, newInner: '入口\n' })
  );
  plan.blockHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

  assert.throws(
    () => applyTargetPlan({ repoRoot: repo, target, plan }),
    /已从备份恢复原文件/
  );
  assert.equal(fs.readFileSync(entryPath, 'utf8'), existing);
});

test('新建文件写后校验失败时清理残留文件', (t) => {
  const { repo, entryPath, target } = makeWorkspace(t);
  const plan = planBlockMerge({ existingText: null, newInner: '入口\n' });
  plan.blockHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

  assert.throws(
    () => applyTargetPlan({ repoRoot: repo, target, plan }),
    /已清理新建文件/
  );
  assert.equal(fs.existsSync(entryPath), false);
});

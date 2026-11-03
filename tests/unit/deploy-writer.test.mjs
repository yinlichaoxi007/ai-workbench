import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeText } from '../../src/core/lib/encoding.mjs';
import { applyTargetPlan, isWritableAction } from '../../src/core/lib/deploy-writer.mjs';
import { sha256 } from '../../src/core/lib/hash.mjs';
import {
  DEFAULT_MEMORY_BUDGET,
  DEFAULT_MEMORY_MARKERS,
  buildSplitFileContent,
  planMemoryBlock,
  splitFileHashOf
} from '../../src/core/lib/memory-block.mjs';
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

test('可写动作集合只包含新建、追加、插入和更新', () => {
  for (const action of ['create-file', 'append-block', 'insert-block', 'update-block']) {
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

function makeMemoryWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-memory-writer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entryPath = path.join(root, 'home', 'MEMORY.md');
  const splitPath = path.join(root, 'home', 'memory', 'ai-workbench-global-rules.md');
  return {
    repo: root,
    entryPath,
    splitPath,
    target: {
      id: 'workbuddy',
      entryPath,
      strategy: 'memory-block',
      entry: { markers: DEFAULT_MEMORY_MARKERS, splitFilePath: splitPath }
    }
  };
}

function memoryPlan({ entryPath, splitPath, workbenchInner, ...overrides }) {
  const entryBuffer = fs.existsSync(entryPath) ? fs.readFileSync(entryPath) : null;
  const splitBuffer = fs.existsSync(splitPath) ? fs.readFileSync(splitPath) : null;
  const plan = planMemoryBlock({
    existingText: entryBuffer ? decodeText(entryBuffer).text : null,
    workbenchInner,
    splitFilePath: splitPath,
    markers: DEFAULT_MEMORY_MARKERS,
    budget: DEFAULT_MEMORY_BUDGET,
    splitFile: splitBuffer
      ? {
          exists: true,
          text: decodeText(splitBuffer).text,
          hash: sha256(splitBuffer)
        }
      : { exists: false, text: null, hash: null },
    ...overrides
  });
  plan.fileHash = entryBuffer ? sha256(entryBuffer) : null;
  return plan;
}

test('记忆新建：内联写入不生成拆分文件，保持无 BOM 与 LF', (t) => {
  const { repo, entryPath, splitPath, target } = makeMemoryWorkspace(t);
  const plan = memoryPlan({
    entryPath,
    splitPath,
    workbenchInner: '# 全局规则\n\n- 一条\n'
  });
  assert.equal(plan.action, 'create-file');
  assert.equal(plan.memoryMode, 'inline');

  const result = applyTargetPlan({ repoRoot: repo, target, plan });
  assert.equal(result.memoryMode, 'inline');
  assert.equal(result.splitFilePath, null);
  assert.equal(fs.existsSync(splitPath), false);

  const buffer = fs.readFileSync(entryPath);
  const decoded = decodeText(buffer);
  assert.equal(decoded.hasBom, false);
  assert.equal(decoded.text.includes('\r'), false);
  assert.equal(
    findBlock(decoded.text, DEFAULT_MEMORY_MARKERS).status,
    'present'
  );
  assert.equal(decoded.text.includes('一条'), true);
});

test('记忆钩子：先写拆分文件再写入口，并保持原文件形态', (t) => {
  const { repo, entryPath, splitPath, target } = makeMemoryWorkspace(t);
  const existing = `${'x'.repeat(3400)}\n`;
  writeExisting(entryPath, existing);
  const plan = memoryPlan({
    entryPath,
    splitPath,
    workbenchInner: '# 全局规则\n\n- 一条\n'
  });
  assert.equal(plan.memoryMode, 'hook');
  assert.equal(plan.splitAction, 'create');

  const result = applyTargetPlan({ repoRoot: repo, target, plan });
  assert.equal(result.memoryMode, 'hook');
  assert.equal(result.splitFilePath, splitPath);
  assert.equal(result.splitFileHash, plan.splitFileHash);

  const entryBuffer = fs.readFileSync(entryPath);
  const entryText = decodeText(entryBuffer).text;
  assert.equal(entryBuffer[0] === 0xef, false);
  assert.equal(entryText.startsWith(DEFAULT_MEMORY_MARKERS.begin), true);
  assert.equal(entryText.includes(existing), true);
  assert.equal(entryText.includes('\r'), false);

  const splitBuffer = fs.readFileSync(splitPath);
  const splitText = decodeText(splitBuffer).text;
  assert.equal(splitBuffer[0] === 0xef, false);
  assert.equal(splitText.includes('\r'), false);
  assert.equal(splitText.includes('一条'), true);
  assert.equal(splitText.startsWith('# AI 工作台全局规则\n'), true);

  const again = memoryPlan({
    entryPath,
    splitPath,
    workbenchInner: '# 全局规则\n\n- 一条\n',
    storedBlockHash: plan.blockHash,
    storedSplitFileHash: result.splitFileHash
  });
  assert.equal(again.action, 'unchanged');
});

test('记忆入口保留原有 BOM 与 CRLF', (t) => {
  const { repo, entryPath, splitPath, target } = makeMemoryWorkspace(t);
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.writeFileSync(
    entryPath,
    Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(`${'x'.repeat(3400)}\r\n`, 'utf8')
    ])
  );

  const plan = memoryPlan({
    entryPath,
    splitPath,
    workbenchInner: '# 全局规则\n\n- 一条\n'
  });
  assert.equal(plan.memoryMode, 'hook');
  applyTargetPlan({ repoRoot: repo, target, plan });

  const buffer = fs.readFileSync(entryPath);
  const decoded = decodeText(buffer);
  assert.equal(decoded.hasBom, true);
  assert.deepEqual([...buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(decoded.text.startsWith(DEFAULT_MEMORY_MARKERS.begin), true);
  assert.equal(/(^|[^\r])\n/.test(decoded.text), false);
  assert.equal(decoded.text.includes('一条'), false);
  assert.equal(decoded.text.includes('完整规则见'), true);
});

test('内联模式删除上次部署的拆分文件', (t) => {
  const { repo, entryPath, splitPath, target } = makeMemoryWorkspace(t);
  const inner = '# 全局规则\n\n- 一条\n';
  const splitContent = buildSplitFileContent(inner);
  fs.mkdirSync(path.dirname(splitPath), { recursive: true });
  fs.writeFileSync(splitPath, splitContent, 'utf8');
  writeExisting(entryPath, '# 记忆\n');

  const plan = memoryPlan({ entryPath, splitPath, workbenchInner: inner });
  assert.equal(plan.action, 'insert-block');
  assert.equal(plan.memoryMode, 'inline');
  assert.equal(plan.splitAction, 'remove');

  const result = applyTargetPlan({ repoRoot: repo, target, plan });
  assert.equal(result.splitFilePath, null);
  assert.equal(fs.existsSync(splitPath), false);
  assert.equal(fs.readFileSync(entryPath, 'utf8').includes('一条'), true);
});

test('拆分文件在预演后变化时拒绝写入', (t) => {
  const { repo, entryPath, splitPath, target } = makeMemoryWorkspace(t);
  const existing = `${'x'.repeat(3400)}\n`;
  writeExisting(entryPath, existing);
  const plan = memoryPlan({
    entryPath,
    splitPath,
    workbenchInner: '# 全局规则\n\n- 一条\n'
  });
  assert.equal(plan.splitAction, 'create');
  fs.mkdirSync(path.dirname(splitPath), { recursive: true });
  fs.writeFileSync(splitPath, '预演后出现的内容\n', 'utf8');

  assert.throws(
    () => applyTargetPlan({ repoRoot: repo, target, plan }),
    /拆分文件在预演后发生变化/
  );
  assert.equal(fs.readFileSync(entryPath, 'utf8'), existing);
  assert.equal(fs.readFileSync(splitPath, 'utf8'), '预演后出现的内容\n');
});

test('记忆写入校验失败时同时回滚入口与拆分文件', (t) => {
  const { repo, entryPath, splitPath, target } = makeMemoryWorkspace(t);
  const existing = `${'x'.repeat(3400)}\n`;
  writeExisting(entryPath, existing);
  const plan = memoryPlan({
    entryPath,
    splitPath,
    workbenchInner: '# 全局规则\n\n- 一条\n'
  });
  plan.blockHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

  assert.throws(
    () => applyTargetPlan({ repoRoot: repo, target, plan }),
    /拆分文件已回滚/
  );
  assert.equal(fs.readFileSync(entryPath, 'utf8'), existing);
  assert.equal(fs.existsSync(splitPath), false);
});

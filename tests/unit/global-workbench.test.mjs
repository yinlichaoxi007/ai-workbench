import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyGlobalWorkbench, planGlobalWorkbench } from '../../src/core/lib/global-workbench.mjs';

function makeWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-global-'));
  t.after(() => {
    const linkPath = path.join(root, 'global', 'scripts', 'ai-workbench');
    if (fs.existsSync(linkPath)) fs.rmSync(linkPath, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'content', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'content', 'scripts', 'demo.mjs'), '#!/usr/bin/env node\n', 'utf8');
  return { root, repo, globalRoot: path.join(root, 'global') };
}

test('预演创建全局工作台目录与脚本 junction，不写入', (t) => {
  const { repo, globalRoot } = makeWorkspace(t);
  const plan = planGlobalWorkbench(repo, globalRoot);

  assert.equal(plan.ok, true);
  assert.equal(plan.conflicts, 0);
  assert.equal(plan.dirs.map((dir) => dir.name).join(','), 'todo,scripts,notes,_tmp');
  assert.equal(plan.dirs.every((dir) => dir.action === 'create-directory'), true);
  assert.equal(plan.link.action, 'create-junction');
  assert.equal(fs.existsSync(globalRoot), false);
});

test('安装后目录与 junction 就位，重复安装保持不变', (t) => {
  const { repo, globalRoot } = makeWorkspace(t);
  const applied = applyGlobalWorkbench(planGlobalWorkbench(repo, globalRoot));

  assert.equal(applied.applied, true);
  for (const name of ['todo', 'scripts', 'notes', '_tmp']) {
    assert.equal(fs.statSync(path.join(globalRoot, name)).isDirectory(), true, name);
  }

  const linkPath = path.join(globalRoot, 'scripts', 'ai-workbench');
  assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
  assert.equal(
    path.resolve(fs.realpathSync(linkPath)),
    path.resolve(fs.realpathSync(path.join(repo, 'content', 'scripts')))
  );

  const again = planGlobalWorkbench(repo, globalRoot);
  assert.equal(again.ok, true);
  assert.equal(again.link.action, 'unchanged');
  assert.equal(again.dirs.every((dir) => dir.action === 'unchanged'), true);
  assert.doesNotThrow(() => applyGlobalWorkbench(again));
});

test('同名 junction 指向别处时报告冲突且不写入', (t) => {
  const { root, repo, globalRoot } = makeWorkspace(t);
  fs.mkdirSync(path.join(globalRoot, 'scripts'), { recursive: true });
  const foreign = path.join(root, 'foreign');
  fs.mkdirSync(foreign);
  fs.symlinkSync(foreign, path.join(globalRoot, 'scripts', 'ai-workbench'), 'junction');

  const plan = planGlobalWorkbench(repo, globalRoot);
  assert.equal(plan.ok, false);
  assert.equal(plan.link.action, 'conflict');
  assert.match(plan.link.reason, /已指向其他位置/);
  assert.throws(() => applyGlobalWorkbench(plan), /冲突/);
  assert.equal(fs.existsSync(path.join(globalRoot, 'todo')), false);
});

test('脚本源不存在时报告冲突', (t) => {
  const { root } = makeWorkspace(t);
  const repo = path.join(root, 'empty');
  fs.mkdirSync(path.join(repo, 'content'), { recursive: true });

  const plan = planGlobalWorkbench(repo, path.join(root, 'global2'));
  assert.equal(plan.ok, false);
  assert.match(plan.link.reason, /脚本源不存在/);
});

test('目录位置被文件占用时报告冲突', (t) => {
  const { repo, globalRoot } = makeWorkspace(t);
  fs.mkdirSync(globalRoot, { recursive: true });
  fs.writeFileSync(path.join(globalRoot, 'notes'), 'x', 'utf8');

  const plan = planGlobalWorkbench(repo, globalRoot);
  assert.equal(plan.ok, false);
  assert.equal(plan.dirs.find((dir) => dir.name === 'notes').action, 'conflict');
});

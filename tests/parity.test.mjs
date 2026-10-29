import test from 'node:test';
import assert from 'node:assert/strict';
import { actions } from '../src/core/registry.mjs';

test('动作注册表 id 唯一且 CLI/GUI 元数据齐全', () => {
  const ids = new Set();
  for (const action of actions) {
    assert.equal(ids.has(action.id), false, `重复动作 id：${action.id}`);
    ids.add(action.id);

    assert.ok(action.title, `${action.id} 缺少 title`);
    assert.ok(action.description, `${action.id} 缺少 description`);
    assert.ok(action.cli?.command, `${action.id} 缺少 cli.command`);
    assert.ok(Array.isArray(action.cli?.options), `${action.id} 缺少 cli.options`);
    assert.ok(action.gui?.page, `${action.id} 缺少 gui.page`);
    assert.ok(Array.isArray(action.gui?.form), `${action.id} 缺少 gui.form`);
    assert.equal(typeof action.run, 'function', `${action.id} 缺少 run`);
  }
});

test('部署动作默认预演，写入范围明确', () => {
  const deploy = actions.find((action) => action.id === 'deploy');
  assert.equal(deploy.dryRun, true);
  assert.equal(deploy.writeScope, 'external');
  assert.equal(deploy.gui.confirm, true);
});

test('只读动作不标记外部写入', () => {
  for (const id of ['detect', 'status', 'doctor']) {
    const action = actions.find((item) => item.id === id);
    assert.equal(action.writeScope, 'none');
  }
});

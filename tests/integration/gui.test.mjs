import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../src/gui/server.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const machineSkip = fs.existsSync(path.join(repoRoot, 'machines', `${os.hostname()}.md`))
  ? {}
  : { skip: '缺少本机机器档案，先按 machines/_template.md 创建 machines/<主机名>.md' };

function start(t) {
  return startRepo(t, repoRoot);
}

function startRepo(t, root) {
  const handle = startServer({ repoRoot: root, hostname: os.hostname(), port: 0 });
  return handle.then((server) => {
    t.after(() => server.close());
    return server;
  });
}

function makeSandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-gui-'));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(repo, 'adapters'), { recursive: true });
  fs.mkdirSync(path.join(home, '.qoder-cn'), { recursive: true });

  const registry = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'adapters', 'targets.json'), 'utf8')
  );
  const resolveHome = (value) => path.join(home, value.slice(2));
  for (const tool of registry.tools) {
    tool.configRoot = resolveHome(tool.configRoot);
    tool.entry.path = resolveHome(tool.entry.path);
    tool.entry.alternatives = (tool.entry.alternatives ?? []).map(resolveHome);
    if (tool.skillsDir) tool.skillsDir = resolveHome(tool.skillsDir);
  }
  fs.writeFileSync(
    path.join(repo, 'adapters', 'targets.json'),
    `${JSON.stringify(registry, null, 2)}\n`,
    'utf8'
  );

  const entryPath = path.join(home, '.qoder-cn', 'AGENTS.md');
  fs.writeFileSync(entryPath, '# 用户规则\n', 'utf8');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  return { repo, entryPath };
}

async function call(server, action, params = {}, confirm = false, token = server.token) {
  const response = await fetch(`http://127.0.0.1:${server.port}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AIWB-Token': token },
    body: JSON.stringify({ action, params, confirm })
  });
  const data = await response.json();
  return { status: response.status, data };
}

test('GUI 页面与接口要求访问令牌', machineSkip, async (t) => {
  const server = await start(t);

  const page = await fetch(`http://127.0.0.1:${server.port}/`);
  assert.equal(page.status, 403);

  const api = await call(server, 'status', {}, false, 'wrong-token');
  assert.equal(api.status, 403);

  const okPage = await fetch(`http://127.0.0.1:${server.port}/?token=${server.token}`);
  assert.equal(okPage.status, 200);
  assert.match(await okPage.text(), /AI 工作台/);

  const js = await fetch(`http://127.0.0.1:${server.port}/app.js`);
  assert.equal(js.status, 200);
  assert.match(await js.text(), /function api/);
});

test('GUI 只开放只读动作，写入必须显式确认', machineSkip, async (t) => {
  const server = await start(t);

  const status = await call(server, 'status');
  assert.equal(status.status, 200);
  assert.equal(status.data.ok, true);
  assert.equal(status.data.result.targets.length, 7);

  const detect = await call(server, 'detect');
  assert.equal(detect.status, 200);
  assert.equal(detect.data.result.tools.length, 7);

  const preview = await call(server, 'deploy', { dryRun: true });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.result.dryRun, true);
  assert.equal(preview.data.result.targets.length, 7);
  assert.equal(preview.data.result.skills.skills.length, 1);
  assert.equal(preview.data.result.skills.tools.length, 7);

  const check = await call(server, 'build', { check: true });
  assert.equal(check.status, 200);
  assert.equal(check.data.result.current, true);

  const build = await call(server, 'build');
  assert.equal(build.status, 403);

  const scaffold = await call(server, 'content', { positionals: ['new-rule', 'tmp'] });
  assert.equal(scaffold.status, 403);

  const deployNoConfirm = await call(server, 'deploy', { apply: true });
  assert.equal(deployNoConfirm.status, 403);
  assert.match(deployNoConfirm.data.error, /确认/);

  const backup = await call(server, 'backup', { positionals: ['list'] });
  assert.equal(backup.status, 200);
  assert.equal(Array.isArray(backup.data.result.backups), true);

  const restoreNoConfirm = await call(server, 'backup', {
    positionals: ['restore', 'qoder-cn', '20260101-000000-000'],
    apply: true
  });
  assert.equal(restoreNoConfirm.status, 403);
});

test('GUI 主动备份写本地，未确认时拒绝', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const server = await startRepo(t, sandbox.repo);

  const noConfirm = await call(server, 'backup', { positionals: ['create'] });
  assert.equal(noConfirm.status, 403);
  assert.match(noConfirm.data.error, /确认/);

  const created = await call(server, 'backup', { positionals: ['create'] }, true);
  assert.equal(created.status, 200);
  assert.equal(created.data.result.subcommand, 'create');
  assert.equal(created.data.result.summary.created, 1);
  assert.equal(created.data.result.summary.missing, 6);
  assert.equal(created.data.result.summary.failed, 0);

  const qoder = created.data.result.tools.find((tool) => tool.id === 'qoder-cn');
  assert.equal(qoder.status, 'created');
  assert.match(qoder.backup, /state\/backups\/qoder-cn\//);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), '# 用户规则\n');

  const listed = await call(server, 'backup', { positionals: ['list'] });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.result.backups.length, 1);
  assert.equal(listed.data.result.backups[0].action, 'manual');
});

test('GUI 拒绝未知动作与非法参数', machineSkip, async (t) => {
  const server = await start(t);

  const unknown = await call(server, 'shell', {});
  assert.equal(unknown.status, 400);
  assert.match(unknown.data.error, /不支持的动作/);

  const backupSubcommand = await call(server, 'backup', { positionals: ['prune'] });
  assert.equal(backupSubcommand.status, 400);
});

test('gui 命令拒绝非法端口', machineSkip, () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.mjs'), 'gui', '--port', 'abc'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, AIWB_DEBUG: '' }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /端口不合法/);
});

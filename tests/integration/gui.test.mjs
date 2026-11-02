import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as buildAction from '../../src/core/actions/build.mjs';
import { startServer } from '../../src/gui/server.mjs';
import { sha256 } from '../../src/core/lib/hash.mjs';
import { findBlock, wrapBlock } from '../../src/core/lib/merge-engine.mjs';

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
  const projectsRoot = path.join(root, 'projects');
  const globalRoot = path.join(root, 'global');
  fs.mkdirSync(path.join(repo, 'adapters'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'machines'), { recursive: true });
  fs.mkdirSync(path.join(home, '.qoder-cn'), { recursive: true });
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.cpSync(path.join(repoRoot, 'content'), path.join(repo, 'content'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'VERSION'), path.join(repo, 'VERSION'));
  fs.writeFileSync(
    path.join(repo, 'machines', `${os.hostname()}.md`),
    [
      '---',
      `host: ${os.hostname()}`,
      'backupRetention: 2',
      '---',
      '',
      '## 路径',
      '',
      `- 项目父级：${projectsRoot}`,
      `- 全局工作台：${globalRoot}`,
      '',
      '## 项目清单',
      '',
      '| 名称 | 路径 | 技术栈 | 构建/测试 | 备注 |',
      '|---|---|---|---|---|',
      ''
    ].join('\n'),
    'utf8'
  );

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
  t.after(() => {
    for (const linkPath of [
      path.join(home, '.qoder-cn', 'skills', 'aiwb'),
      path.join(root, 'global', 'scripts', 'ai-workbench')
    ]) {
      try {
        if (fs.lstatSync(linkPath).isSymbolicLink()) fs.unlinkSync(linkPath);
      } catch {
        // 链接可能不存在。
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  return { repo, entryPath, projectsRoot, globalRoot };
}

function initProject(sandbox, name) {
  const projectPath = path.join(sandbox.projectsRoot, name);
  fs.mkdirSync(projectPath, { recursive: true });
  const init = spawnSync('git', ['init', '--quiet', projectPath], { encoding: 'utf8' });
  if (init.error) throw init.error;
  return projectPath;
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

test('GUI 无可执行内容时相关按钮初始禁用', machineSkip, async (t) => {
  const server = await start(t);

  const page = await fetch(`http://127.0.0.1:${server.port}/?token=${server.token}`);
  const html = await page.text();
  assert.match(html, /id="merge-load" class="primary" disabled/);
  assert.match(html, /id="settings-preview" class="primary" disabled/);
  assert.match(html, /id="settings-reset" disabled/);
  assert.match(html, /id="backup-prune" disabled/);
  assert.match(html, /id="content-revert" disabled/);
  assert.match(html, /id="content-validate" class="primary" disabled/);
  assert.match(html, /id="content-save" class="danger" disabled/);
  assert.match(html, /id="content-new-create" type="submit" class="danger" disabled/);

  const js = await fetch(`http://127.0.0.1:${server.port}/app.js`);
  const script = await js.text();
  assert.match(script, /function syncMergeLoadState\(\)/);
  assert.match(script, /function syncSettingsActions\(\)/);
  assert.match(script, /#backup-prune'\)\.disabled = result\.backups\.length === 0/);
  assert.match(script, /function syncContentSave\(\)/);
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

  const uninstallNoConfirm = await call(server, 'uninstall', {
    tool: 'qoder-cn',
    apply: true
  });
  assert.equal(uninstallNoConfirm.status, 403);
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

test('GUI 清理旧备份默认预演，确认后删除', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const server = await startRepo(t, sandbox.repo);

  for (let index = 0; index < 3; index += 1) {
    const created = await call(server, 'backup', { positionals: ['create'] }, true);
    assert.equal(created.status, 200);
  }

  const preview = await call(server, 'backup', { positionals: ['prune'] });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.result.dryRun, true);
  assert.equal(preview.data.result.keep, 2);
  assert.equal(preview.data.result.keepSource, 'machine');
  assert.equal(preview.data.result.summary.delete, 1);
  assert.equal(preview.data.result.summary.deleted, 0);

  const candidate = preview.data.result.items.find((item) => item.status === 'delete');
  const candidateDir = path.join(sandbox.repo, candidate.relativeDir);
  assert.equal(fs.existsSync(candidateDir), true);

  const noConfirm = await call(server, 'backup', {
    positionals: ['prune'],
    apply: true,
    keep: preview.data.result.keep
  });
  assert.equal(noConfirm.status, 403);
  assert.equal(fs.existsSync(candidateDir), true);

  const applied = await call(
    server,
    'backup',
    { positionals: ['prune'], apply: true, keep: preview.data.result.keep },
    true
  );
  assert.equal(applied.status, 200);
  assert.equal(applied.data.result.dryRun, false);
  assert.equal(applied.data.result.summary.deleted, 1);
  assert.equal(fs.existsSync(candidateDir), false);

  const listed = await call(server, 'backup', { positionals: ['list'] });
  assert.equal(listed.data.result.backups.length, 2);
});

test('GUI 卸载默认预演，确认后移除工作台块', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const userText = '# 用户规则\n';
  const entryText = `${userText}${wrapBlock('入口内容')}\n`;
  fs.writeFileSync(sandbox.entryPath, entryText, 'utf8');
  const found = findBlock(entryText);
  fs.mkdirSync(path.join(sandbox.repo, 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(sandbox.repo, 'state', 'deploy-state.json'),
    `${JSON.stringify(
      {
        version: 1,
        machine: os.hostname(),
        lastRun: '2026-10-31T00:00:00.000+08:00',
        targets: {
          'qoder-cn': {
            entryPath: sandbox.entryPath,
            action: 'append-block',
            blockHash: found.blockHash,
            fileHash: sha256(Buffer.from(entryText, 'utf8')),
            contentHash: 'sha256:old',
            backup: null,
            deployedAt: '2026-10-31T00:00:00.000+08:00'
          }
        },
        projects: {}
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  const server = await startRepo(t, sandbox.repo);

  const preview = await call(server, 'uninstall', { tool: 'qoder-cn' });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.result.dryRun, true);
  assert.equal(preview.data.result.summary.removeBlock, 1);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), entryText);

  const noConfirm = await call(server, 'uninstall', { tool: 'qoder-cn', apply: true });
  assert.equal(noConfirm.status, 403);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), entryText);

  const applied = await call(
    server,
    'uninstall',
    { tool: 'qoder-cn', apply: true },
    true
  );
  assert.equal(applied.status, 200);
  assert.equal(applied.data.result.apply.removedBlocks, 1);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), userText);

  const state = JSON.parse(
    fs.readFileSync(path.join(sandbox.repo, 'state', 'deploy-state.json'), 'utf8')
  );
  assert.equal(state.targets['qoder-cn'], undefined);
  assert.equal(fs.existsSync(path.join(sandbox.repo, 'state', 'backups', 'qoder-cn')), true);
});

test('GUI 合并只写块内正文，块外原文保持不变', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const userText = '# 用户规则\n';
  const server = await startRepo(t, sandbox.repo);

  const noContentFile = await call(server, 'merge', {
    tool: 'qoder-cn',
    contentFile: sandbox.entryPath
  });
  assert.equal(noContentFile.status, 403);
  assert.match(noContentFile.data.error, /不读取任意文件/);

  const preview = await call(server, 'merge', { tool: 'qoder-cn' });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.result.dryRun, true);
  assert.equal(preview.data.result.status, 'ready');
  assert.equal(preview.data.result.canApply, true);
  assert.equal(preview.data.result.entry.exists, true);
  assert.equal(preview.data.result.entry.blockStatus, 'absent');
  assert.equal(preview.data.result.entry.fileHash, preview.data.result.expected.fileHash);
  assert.equal(preview.data.result.suggested.startsWith(userText), true);
  assert.equal(preview.data.result.suggested.includes('AI-WORKBENCH:BEGIN'), true);

  const applyParams = {
    tool: 'qoder-cn',
    content: preview.data.result.suggested,
    expectedFileHash: preview.data.result.expected.fileHash,
    expectedBuildHash: preview.data.result.expected.buildHash,
    apply: true
  };

  const noConfirm = await call(server, 'merge', applyParams);
  assert.equal(noConfirm.status, 403);
  assert.match(noConfirm.data.error, /确认/);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), userText);

  const outsideChanged = await call(
    server,
    'merge',
    {
      ...applyParams,
      content: preview.data.result.suggested.replace('# 用户规则', '# 用户规则（改）')
    },
    true
  );
  assert.equal(outsideChanged.status, 200);
  assert.equal(outsideChanged.data.result.status, 'blocked');
  assert.equal(outsideChanged.data.result.applied, false);
  assert.equal(
    outsideChanged.data.result.issues.some((issue) => issue.code === 'prefix-changed'),
    true
  );
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), userText);

  const suggestedBlock = findBlock(preview.data.result.suggested);
  assert.equal(suggestedBlock.status, 'present');
  const merged = `${preview.data.result.suggested.slice(0, suggestedBlock.beginIndex)}${wrapBlock(
    '自定义合并内容'
  )}${preview.data.result.suggested.slice(suggestedBlock.endIndex)}`;

  const applied = await call(server, 'merge', { ...applyParams, content: merged }, true);
  assert.equal(applied.status, 200);
  assert.equal(applied.data.result.status, 'written');
  assert.equal(applied.data.result.applied, true);
  assert.match(applied.data.result.backup, /state\/backups\/qoder-cn\//);
  assert.equal(applied.data.result.merged.blockHash, findBlock(merged).blockHash);
  assert.equal(applied.data.result.entry.modifiedSinceDeploy, false);
  assert.equal(applied.data.result.warnings.length, 0);

  const written = fs.readFileSync(sandbox.entryPath, 'utf8');
  assert.equal(written.startsWith(userText), true);
  assert.equal(written.includes('自定义合并内容'), true);
  assert.equal(findBlock(written).status, 'present');

  const state = JSON.parse(
    fs.readFileSync(path.join(sandbox.repo, 'state', 'deploy-state.json'), 'utf8')
  );
  assert.equal(state.targets['qoder-cn'].action, 'manual-merge');
  assert.equal(state.targets['qoder-cn'].manualMerge, true);
  assert.equal(state.targets['qoder-cn'].blockHash, applied.data.result.merged.blockHash);

  const after = await call(server, 'merge', { tool: 'qoder-cn' });
  assert.equal(after.data.result.entry.blockStatus, 'present');
  assert.equal(after.data.result.entry.currentBlockHash, applied.data.result.merged.blockHash);
  assert.equal(after.data.result.entry.modifiedSinceDeploy, false);
  assert.equal(after.data.result.warnings.length, 0);
});

test('GUI 合并拒绝过期入口哈希且不写文件', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const userText = '# 用户规则\n';
  const server = await startRepo(t, sandbox.repo);

  const preview = await call(server, 'merge', { tool: 'qoder-cn' });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.result.canApply, true);

  const stale = await call(
    server,
    'merge',
    {
      tool: 'qoder-cn',
      content: preview.data.result.suggested,
      expectedFileHash: 'sha256:stale',
      expectedBuildHash: preview.data.result.expected.buildHash,
      apply: true
    },
    true
  );
  assert.equal(stale.status, 200);
  assert.equal(stale.data.result.status, 'blocked');
  assert.equal(stale.data.result.applied, false);
  assert.match(stale.data.result.reason, /预演后发生变化/);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), userText);
  assert.equal(fs.existsSync(path.join(sandbox.repo, 'state', 'backups', 'qoder-cn')), false);
});

test('GUI 拒绝未知动作与非法参数', machineSkip, async (t) => {
  const server = await start(t);

  const unknown = await call(server, 'shell', {});
  assert.equal(unknown.status, 400);
  assert.match(unknown.data.error, /不支持的动作/);

  const backupSubcommand = await call(server, 'backup', { positionals: ['remove'] });
  assert.equal(backupSubcommand.status, 400);
  assert.match(backupSubcommand.data.error, /backup/);
});

test('GUI 项目扫描、挂载与取消挂载，写入需确认', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  await buildAction.run({ repoRoot: sandbox.repo, hostname: os.hostname(), now: new Date() });
  const projectPath = initProject(sandbox, 'alpha');
  const entryPath = path.join(projectPath, 'AGENTS.md');
  const server = await startRepo(t, sandbox.repo);

  const scan = await call(server, 'scan');
  assert.equal(scan.status, 200);
  assert.equal(scan.data.result.projects.length, 1);
  assert.equal(scan.data.result.projects[0].status, 'not-mounted');

  const scanRoot = await call(server, 'scan', { root: sandbox.projectsRoot });
  assert.equal(scanRoot.status, 403);
  assert.match(scanRoot.data.error, /项目父级/);

  const preview = await call(server, 'attach', { path: projectPath, mode: 'auto' });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.result.project.action, 'create-file');
  assert.equal(preview.data.result.project.canApply, true);
  assert.equal(fs.existsSync(entryPath), false);

  const noConfirm = await call(server, 'attach', {
    path: projectPath,
    mode: 'auto',
    apply: true
  });
  assert.equal(noConfirm.status, 403);
  assert.equal(fs.existsSync(entryPath), false);

  const applied = await call(
    server,
    'attach',
    { path: projectPath, mode: 'auto', apply: true },
    true
  );
  assert.equal(applied.status, 200);
  assert.equal(applied.data.result.apply.ok, true);
  assert.equal(fs.existsSync(entryPath), true);
  assert.match(
    fs.readFileSync(path.join(projectPath, '.git', 'info', 'exclude'), 'utf8'),
    /^\/AGENTS\.md$/m
  );

  const mounted = await call(server, 'scan');
  assert.equal(mounted.data.result.projects[0].status, 'mounted');

  const detachPreview = await call(server, 'detach', { path: projectPath });
  assert.equal(detachPreview.status, 200);
  assert.equal(detachPreview.data.result.project.status, 'delete-file');

  const detachNoConfirm = await call(server, 'detach', { path: projectPath, apply: true });
  assert.equal(detachNoConfirm.status, 403);
  assert.equal(fs.existsSync(entryPath), true);

  const detached = await call(server, 'detach', { path: projectPath, apply: true }, true);
  assert.equal(detached.status, 200);
  assert.equal(detached.data.result.apply.action, 'delete-file');
  assert.equal(fs.existsSync(entryPath), false);
});

test('GUI 项目挂载拒绝允许范围外的路径与非法参数', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  await buildAction.run({ repoRoot: sandbox.repo, hostname: os.hostname(), now: new Date() });
  initProject(sandbox, 'alpha');
  const outside = path.join(sandbox.repo, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  const server = await startRepo(t, sandbox.repo);

  const notAllowed = await call(server, 'attach', { path: outside });
  assert.equal(notAllowed.status, 403);
  assert.match(notAllowed.data.error, /允许的范围/);

  const relative = await call(server, 'attach', { path: 'outside' });
  assert.equal(relative.status, 400);
  assert.match(relative.data.error, /绝对路径/);

  const badMode = await call(server, 'attach', {
    path: path.join(sandbox.projectsRoot, 'alpha'),
    mode: 'replace'
  });
  assert.equal(badMode.status, 400);
  assert.match(badMode.data.error, /挂载方式/);

  const missing = await call(server, 'attach', {});
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /绝对路径/);
});

test('GUI 设置页查看、预演并确认后写回机器档案', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const machinePath = path.join(sandbox.repo, 'machines', `${os.hostname()}.md`);
  const original = fs.readFileSync(machinePath, 'utf8');
  const server = await startRepo(t, sandbox.repo);

  const show = await call(server, 'settings', { positionals: ['show'] });
  assert.equal(show.status, 200);
  assert.equal(show.data.result.ok, true);
  assert.equal(show.data.result.hasSection, false);
  assert.equal(show.data.result.writable, true);
  assert.deepEqual(show.data.result.env, {});
  assert.deepEqual(show.data.result.overrides, {});
  assert.equal(
    show.data.result.tools.find((tool) => tool.id === 'qoder-cn').overrides.entryPath,
    null
  );

  const changes = {
    backupRetention: 3,
    guiPort: 5088,
    'env.AIWB_SETTINGS_ROOT': sandbox.projectsRoot,
    'tools.qoder-cn.entryPath': '${AIWB_SETTINGS_ROOT}\\agents\\AGENTS.md'
  };
  const preview = await call(server, 'settings', { positionals: ['set'], changes });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.result.dryRun, true);
  assert.equal(preview.data.result.status, 'preview');
  assert.equal(preview.data.result.ok, true);
  assert.equal(preview.data.result.canApply, true);
  assert.deepEqual(
    preview.data.result.changes.map((change) => [change.key, change.action]),
    [
      ['backupRetention', 'update'],
      ['guiPort', 'update'],
      ['env.AIWB_SETTINGS_ROOT', 'set'],
      ['tools.qoder-cn.entryPath', 'set']
    ]
  );
  assert.equal(fs.readFileSync(machinePath, 'utf8'), original);

  const applyParams = {
    positionals: ['set'],
    changes,
    expectedFileHash: preview.data.result.fileHash,
    apply: true
  };
  const noConfirm = await call(server, 'settings', applyParams);
  assert.equal(noConfirm.status, 403);
  assert.match(noConfirm.data.error, /确认/);
  assert.equal(fs.readFileSync(machinePath, 'utf8'), original);

  const applied = await call(server, 'settings', applyParams, true);
  assert.equal(applied.status, 200);
  assert.equal(applied.data.result.status, 'applied');
  assert.equal(applied.data.result.dryRun, false);
  assert.equal(applied.data.result.ok, true);
  assert.match(applied.data.result.backup, /^state\/settings-backups\//);
  assert.equal(
    fs.existsSync(path.join(sandbox.repo, applied.data.result.backup, 'manifest.json')),
    true
  );

  const written = fs.readFileSync(machinePath, 'utf8');
  assert.equal(written.includes('## 设置'), true);
  assert.equal(written.startsWith(original.split('\n')[0]), true);
  assert.equal(written.includes('## 路径'), true);

  const shownAgain = await call(server, 'settings', {});
  assert.equal(shownAgain.status, 200);
  assert.equal(shownAgain.data.result.backupRetention.value, 3);
  assert.equal(shownAgain.data.result.guiPort.value, 5088);
  assert.equal(shownAgain.data.result.env.AIWB_SETTINGS_ROOT, sandbox.projectsRoot);
  assert.equal(
    shownAgain.data.result.tools.find((tool) => tool.id === 'qoder-cn').entryPath,
    path.join(sandbox.projectsRoot, 'agents', 'AGENTS.md')
  );
});

test('GUI 注册自定义工具后可单独部署，删除已部署工具会被阻止', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const configRoot = path.join(sandbox.repo, 'custom-config');
  const entryPath = path.join(configRoot, 'AGENTS.md');
  const server = await startRepo(t, sandbox.repo);

  const page = await fetch(`http://127.0.0.1:${server.port}/?token=${server.token}`);
  const html = await page.text();
  assert.match(html, /总览：先确认工作台现在是什么状态/);
  assert.match(html, /部署：把工作台规则写进 AI 工具/);
  assert.match(html, /合并：把手工调整与最新工作台内容合到一起/);
  assert.match(html, /项目：给单个代码仓库挂上工作台入口/);
  assert.match(html, /设置：管理本机参数与自定义工具/);
  assert.match(html, /备份：给入口文件留一份可恢复的副本/);
  assert.match(html, /id="settings-custom-tools"/);
  assert.match(html, /id="settings-custom-add"/);
  assert.match(html, /id="custom-tool-dialog"/);
  assert.match(html, /id="custom-tool-form"/);

  const show = await call(server, 'settings', { positionals: ['show'] });
  assert.deepEqual(show.data.result.customTools, {});

  const changes = {
    'customTools.my-tool.name': 'My Tool',
    'customTools.my-tool.configRoot': configRoot,
    'customTools.my-tool.entryPath': entryPath,
    'customTools.my-tool.strategy': 'block-append',
    'customTools.my-tool.format': 'markdown',
    'customTools.my-tool.skillsDir': path.join(configRoot, 'skills')
  };
  const preview = await call(server, 'settings', { positionals: ['set'], changes });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.result.status, 'preview');
  assert.equal(preview.data.result.ok, true);
  assert.equal(fs.existsSync(configRoot), false);

  const applied = await call(
    server,
    'settings',
    {
      positionals: ['set'],
      changes,
      expectedFileHash: preview.data.result.fileHash,
      apply: true
    },
    true
  );
  assert.equal(applied.status, 200);
  assert.equal(applied.data.result.status, 'applied');
  assert.equal(applied.data.result.ok, true);
  assert.equal(applied.data.result.customTools['my-tool'].entryPath, entryPath);

  const shown = await call(server, 'settings', { positionals: ['show'] });
  assert.equal(shown.data.result.customTools['my-tool'].name, 'My Tool');
  assert.equal(
    shown.data.result.tools.find((tool) => tool.id === 'my-tool').custom,
    true
  );

  const detect = await call(server, 'detect');
  const detected = detect.data.result.tools.find((tool) => tool.id === 'my-tool');
  assert.ok(detected);
  assert.equal(detected.custom, true);
  assert.equal(detected.installed, false);
  assert.equal(detected.configRootExists, false);

  const deployPreview = await call(server, 'deploy', { tool: 'my-tool', dryRun: true });
  assert.equal(deployPreview.status, 200);
  assert.equal(deployPreview.data.result.targets.length, 1);
  assert.equal(deployPreview.data.result.targets[0].custom, true);
  assert.equal(deployPreview.data.result.targets[0].action, 'create-file');
  assert.equal(fs.existsSync(entryPath), false);

  const deployNoConfirm = await call(server, 'deploy', {
    tool: 'my-tool',
    apply: true
  });
  assert.equal(deployNoConfirm.status, 403);
  assert.equal(fs.existsSync(entryPath), false);

  const deployed = await call(
    server,
    'deploy',
    { tool: 'my-tool', apply: true },
    true
  );
  assert.equal(deployed.status, 200);
  assert.equal(deployed.data.result.apply.ok, true);
  assert.equal(deployed.data.result.targets[0].applyStatus, 'written');
  assert.equal(fs.existsSync(entryPath), true);
  assert.equal(findBlock(fs.readFileSync(entryPath, 'utf8')).status, 'present');
  assert.equal(
    fs.lstatSync(path.join(configRoot, 'skills', 'aiwb')).isSymbolicLink(),
    true
  );

  const blockedRemoval = await call(server, 'settings', {
    positionals: ['set'],
    changes: { 'customTools.my-tool': null }
  });
  assert.equal(blockedRemoval.status, 200);
  assert.equal(blockedRemoval.data.result.status, 'preview');
  assert.equal(blockedRemoval.data.result.ok, false);
  assert.match(
    blockedRemoval.data.result.issues.find(
      (issue) => issue.key === 'customTools.my-tool'
    ).message,
    /先在部署页卸载/
  );
  assert.equal(shown.data.result.customTools['my-tool'].name, 'My Tool');

  const uninstallPreview = await call(server, 'uninstall', { tool: 'my-tool' });
  assert.equal(uninstallPreview.status, 200);
  const uninstalled = await call(
    server,
    'uninstall',
    { tool: 'my-tool', apply: true },
    true
  );
  assert.equal(uninstalled.status, 200);
  assert.equal(uninstalled.data.result.apply.ok, true);
  assert.equal(fs.existsSync(entryPath), false);

  const removable = await call(server, 'settings', {
    positionals: ['set'],
    changes: { 'customTools.my-tool': null }
  });
  assert.equal(removable.data.result.ok, true);
  const removed = await call(
    server,
    'settings',
    {
      positionals: ['set'],
      changes: { 'customTools.my-tool': null },
      expectedFileHash: removable.data.result.fileHash,
      apply: true
    },
    true
  );
  assert.equal(removed.status, 200);
  assert.equal(removed.data.result.status, 'applied');
  assert.deepEqual(removed.data.result.customTools, {});

  const detectAfter = await call(server, 'detect');
  assert.equal(
    detectAfter.data.result.tools.some((tool) => tool.id === 'my-tool'),
    false
  );
});

test('GUI 版本字段展示并阻止不符版本的部署与合并', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const configRoot = path.join(sandbox.repo, 'version-config');
  const entryPath = path.join(configRoot, 'AGENTS.md');
  fs.mkdirSync(configRoot, { recursive: true });
  fs.writeFileSync(
    path.join(configRoot, '.status.json'),
    JSON.stringify({ appVersion: '2.0.0' }),
    'utf8'
  );
  const server = await startRepo(t, sandbox.repo);

  const page = await fetch(`http://127.0.0.1:${server.port}/?token=${server.token}`);
  const html = await page.text();
  assert.match(html, /data-custom-field="version"/);
  assert.match(html, /版本要求（可选）/);
  const script = await (await fetch(`http://127.0.0.1:${server.port}/app.js`)).text();
  assert.match(script, /data-setting-field="version"/);
  assert.match(script, /skip-version-blocked/);

  const show = await call(server, 'settings', { positionals: ['show'] });
  const qoder = show.data.result.tools.find((tool) => tool.id === 'qoder-cn');
  assert.equal(qoder.overrides.version, null);
  assert.equal(qoder.versionCheck.checked, false);

  const changes = {
    'customTools.my-tool.name': 'Version Tool',
    'customTools.my-tool.configRoot': configRoot,
    'customTools.my-tool.entryPath': entryPath,
    'customTools.my-tool.version': '>=1.0,(<1.5 || >=3.0)'
  };
  const preview = await call(server, 'settings', { positionals: ['set'], changes });
  assert.equal(preview.data.result.ok, true);
  assert.equal(
    preview.data.result.customTools['my-tool'].version,
    '>=1.0,(<1.5 || >=3.0)'
  );

  const applied = await call(
    server,
    'settings',
    {
      positionals: ['set'],
      changes,
      expectedFileHash: preview.data.result.fileHash,
      apply: true
    },
    true
  );
  assert.equal(applied.data.result.status, 'applied');

  const shown = await call(server, 'settings', { positionals: ['show'] });
  const custom = shown.data.result.tools.find((tool) => tool.id === 'my-tool');
  assert.equal(
    shown.data.result.customTools['my-tool'].version,
    '>=1.0,(<1.5 || >=3.0)'
  );
  assert.equal(custom.detectedVersion, '2.0.0');
  assert.equal(custom.versionCheck.status, 'mismatch');

  const detect = await call(server, 'detect');
  const detected = detect.data.result.tools.find((tool) => tool.id === 'my-tool');
  assert.equal(detected.versionCheck.status, 'mismatch');
  assert.equal(detected.version, '>=1.0,(<1.5 || >=3.0)');

  const deployPreview = await call(server, 'deploy', { tool: 'my-tool', dryRun: true });
  assert.equal(deployPreview.status, 200);
  assert.equal(deployPreview.data.result.summary.versionBlocked, 1);
  assert.equal(deployPreview.data.result.targets[0].action, 'version-blocked');
  assert.equal(fs.existsSync(entryPath), false);

  const deployNoConfirm = await call(server, 'deploy', {
    tool: 'my-tool',
    apply: true
  });
  assert.equal(deployNoConfirm.status, 403);
  assert.equal(fs.existsSync(entryPath), false);

  const deploy = await call(server, 'deploy', { tool: 'my-tool', apply: true }, true);
  assert.equal(deploy.status, 200);
  assert.equal(deploy.data.result.apply.blocked, 1);
  assert.equal(deploy.data.result.apply.written, 0);
  assert.equal(fs.existsSync(entryPath), false);

  const merge = await call(server, 'merge', { tool: 'my-tool' });
  assert.equal(merge.status, 200);
  assert.equal(merge.data.result.status, 'blocked');
  assert.equal(
    merge.data.result.issues.some((issue) => issue.code === 'version-blocked'),
    true
  );
  assert.equal(merge.data.result.tool.versionCheck.status, 'mismatch');
});

test('GUI 设置拒绝过期哈希且不写文件', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const machinePath = path.join(sandbox.repo, 'machines', `${os.hostname()}.md`);
  const server = await startRepo(t, sandbox.repo);

  const preview = await call(server, 'settings', {
    positionals: ['set'],
    changes: { guiPort: 5088 }
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.result.status, 'preview');

  fs.appendFileSync(machinePath, '\n<!-- 设置预演后修改 -->\n', 'utf8');
  const changed = fs.readFileSync(machinePath, 'utf8');

  const stale = await call(
    server,
    'settings',
    {
      positionals: ['set'],
      changes: { guiPort: 5088 },
      expectedFileHash: preview.data.result.fileHash,
      apply: true
    },
    true
  );
  assert.equal(stale.status, 200);
  assert.equal(stale.data.result.status, 'blocked');
  assert.equal(stale.data.result.ok, false);
  assert.match(stale.data.result.reason, /预演后已变化/);
  assert.equal(fs.readFileSync(machinePath, 'utf8'), changed);
  assert.equal(fs.existsSync(path.join(sandbox.repo, 'state', 'settings-backups')), false);
});

test('GUI 设置拒绝非法子命令与参数', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const server = await startRepo(t, sandbox.repo);

  const unknown = await call(server, 'settings', { positionals: ['remove'] });
  assert.equal(unknown.status, 400);
  assert.match(unknown.data.error, /settings/);

  const showWithChanges = await call(server, 'settings', {
    positionals: ['show'],
    changes: { guiPort: 5088 }
  });
  assert.equal(showWithChanges.status, 400);
  assert.match(showWithChanges.data.error, /查看设置/);

  const missingChanges = await call(server, 'settings', { positionals: ['set'] });
  assert.equal(missingChanges.status, 400);
  assert.match(missingChanges.data.error, /changes/);

  const emptyChanges = await call(server, 'settings', { positionals: ['set'], changes: {} });
  assert.equal(emptyChanges.status, 400);
  assert.match(emptyChanges.data.error, /不能为空/);

  const arrayChanges = await call(server, 'settings', {
    positionals: ['set'],
    changes: ['guiPort=5088']
  });
  assert.equal(arrayChanges.status, 400);
  assert.match(arrayChanges.data.error, /必须是对象/);

  const badHash = await call(server, 'settings', {
    positionals: ['set'],
    changes: { guiPort: 5088 },
    expectedFileHash: 'sha256:stale'
  });
  assert.equal(badHash.status, 400);
  assert.match(badHash.data.error, /SHA-256/);

  const bothFlags = await call(server, 'settings', {
    positionals: ['set'],
    changes: { guiPort: 5088 },
    apply: true,
    dryRun: true
  }, true);
  assert.equal(bothFlags.status, 400);
  assert.match(bothFlags.data.error, /不能同时使用/);
});

test('GUI 内容页可列表、读取、预演并确认后保存重建构建', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const server = await startRepo(t, sandbox.repo);
  const ruleFile = path.join(sandbox.repo, 'content', 'rules', '01-communication.md');

  const listed = await call(server, 'content', { positionals: ['list'] });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.result.rules.length, 5);
  assert.equal(listed.data.result.rules[0].isIndex, true);
  assert.equal(listed.data.result.skills.length, 1);
  assert.equal(listed.data.result.skills[0].builtin, true);

  const read = await call(server, 'content', { positionals: ['read', 'rule', '01-communication'] });
  assert.equal(read.status, 200);
  assert.equal(read.data.result.file, 'content/rules/01-communication.md');
  assert.equal(read.data.result.fileHash, sha256(fs.readFileSync(ruleFile)));

  const original = read.data.result.content;
  const draft = `${original.trimEnd()}\n\n- GUI 预演补充。\n`;

  const preview = await call(server, 'content', {
    positionals: ['save', 'rule', '01-communication'],
    content: draft,
    dryRun: true,
    expectedFileHash: read.data.result.fileHash
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.result.status, 'preview');
  assert.equal(preview.data.result.canApply, true);
  assert.equal(fs.readFileSync(ruleFile, 'utf8'), original);

  const noConfirm = await call(server, 'content', {
    positionals: ['save', 'rule', '01-communication'],
    content: draft,
    apply: true,
    expectedFileHash: read.data.result.fileHash
  });
  assert.equal(noConfirm.status, 403);
  assert.match(noConfirm.data.error, /确认/);

  const missingHash = await call(server, 'content', {
    positionals: ['save', 'rule', '01-communication'],
    content: draft,
    apply: true
  }, true);
  assert.equal(missingHash.status, 400);
  assert.match(missingHash.data.error, /文件哈希/);

  const applied = await call(server, 'content', {
    positionals: ['save', 'rule', '01-communication'],
    content: draft,
    apply: true,
    expectedFileHash: read.data.result.fileHash
  }, true);
  assert.equal(applied.status, 200);
  assert.equal(applied.data.result.status, 'applied');
  assert.equal(applied.data.result.build.rebuilt, true);
  assert.equal(applied.data.result.build.entry, 'dist/ENTRY.md');
  assert.equal(fs.readFileSync(ruleFile, 'utf8'), draft);
  assert.equal(fs.existsSync(path.join(sandbox.repo, 'dist', 'ENTRY.md')), true);

  const current = await call(server, 'build', { check: true });
  assert.equal(current.data.result.current, true);

  const stale = await call(server, 'content', {
    positionals: ['save', 'rule', '01-communication'],
    content: draft,
    apply: true,
    expectedFileHash: read.data.result.fileHash
  }, true);
  assert.equal(stale.status, 200);
  assert.equal(stale.data.result.status, 'blocked');
  assert.match(stale.data.result.reason, /已变化/);
  assert.equal(fs.readFileSync(ruleFile, 'utf8'), draft);

  const unchanged = await call(server, 'content', {
    positionals: ['save', 'rule', '01-communication'],
    content: draft,
    apply: true,
    expectedFileHash: applied.data.result.fileHash
  }, true);
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.data.result.status, 'unchanged');
});

test('GUI 内容页新建规则与技能在确认后创建并重建构建', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const server = await startRepo(t, sandbox.repo);

  const preview = await call(server, 'content', {
    positionals: ['new-rule', 'gui-rule'],
    title: 'GUI 新规则',
    dryRun: true
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.result.dryRun, true);
  assert.equal(fs.existsSync(path.join(sandbox.repo, 'content', 'rules', '05-gui-rule.md')), false);

  const noConfirm = await call(server, 'content', {
    positionals: ['new-rule', 'gui-rule'],
    title: 'GUI 新规则',
    build: true
  });
  assert.equal(noConfirm.status, 403);

  const rule = await call(server, 'content', {
    positionals: ['new-rule', 'gui-rule'],
    title: 'GUI 新规则',
    build: true
  }, true);
  assert.equal(rule.status, 200);
  assert.equal(rule.data.result.file, 'content/rules/05-gui-rule.md');
  assert.equal(rule.data.result.build.rebuilt, true);
  assert.equal(fs.existsSync(path.join(sandbox.repo, rule.data.result.file)), true);

  const skill = await call(server, 'content', {
    positionals: ['new-skill', 'gui-skill'],
    title: 'GUI 新技能',
    description: '当需要验证内容页新建技能流程时使用',
    build: true
  }, true);
  assert.equal(skill.status, 200);
  assert.equal(skill.data.result.file, 'content/skills/gui-skill/SKILL.md');
  assert.equal(skill.data.result.build.rebuilt, true);

  const after = await call(server, 'content', { positionals: ['list'] });
  assert.equal(after.data.result.rules.some((entry) => entry.name === '05-gui-rule'), true);
  assert.equal(after.data.result.skills.some((entry) => entry.name === 'gui-skill'), true);

  const lint = await call(server, 'content', { positionals: ['lint'] });
  assert.equal(lint.data.result.ok, true);
});

test('GUI 内容接口拒绝非法子命令、任意文件与缺参', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const server = await startRepo(t, sandbox.repo);

  const unknown = await call(server, 'content', { positionals: ['remove', 'rule', '01-communication'] });
  assert.equal(unknown.status, 400);
  assert.match(unknown.data.error, /content/);

  const contentFile = await call(server, 'content', {
    positionals: ['save', 'rule', '01-communication'],
    contentFile: 'C:/Windows/win.ini',
    apply: true
  }, true);
  assert.equal(contentFile.status, 403);
  assert.match(contentFile.data.error, /任意文件/);

  const lintWithBody = await call(server, 'content', {
    positionals: ['lint'],
    content: '# 任意正文\n'
  });
  assert.equal(lintWithBody.status, 400);

  const readWithoutName = await call(server, 'content', { positionals: ['read', 'rule'] });
  assert.equal(readWithoutName.status, 400);
  assert.match(readWithoutName.data.error, /类型和名称/);

  const emptySave = await call(server, 'content', {
    positionals: ['save', 'rule', '01-communication'],
    content: '   '
  });
  assert.equal(emptySave.status, 400);
  assert.match(emptySave.data.error, /不能为空/);

  const badHash = await call(server, 'content', {
    positionals: ['save', 'rule', '01-communication'],
    content: '# 正文\n',
    apply: true,
    expectedFileHash: 'sha256:stale'
  }, true);
  assert.equal(badHash.status, 400);
  assert.match(badHash.data.error, /SHA-256/);

  const bothFlags = await call(server, 'content', {
    positionals: ['save', 'rule', '01-communication'],
    content: '# 正文\n',
    apply: true,
    dryRun: true
  }, true);
  assert.equal(bothFlags.status, 400);
  assert.match(bothFlags.data.error, /不能同时使用/);

  const createWithoutName = await call(server, 'content', {
    positionals: ['new-rule'],
    build: true
  }, true);
  assert.equal(createWithoutName.status, 400);
  assert.match(createWithoutName.data.error, /名称/);

  const createWithBody = await call(server, 'content', {
    positionals: ['new-rule', 'gui-rule'],
    content: '# 正文\n'
  });
  assert.equal(createWithBody.status, 400);
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

test('GUI 历史页读取操作日志、部署记录与漂移，写入来源标记为 gui', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const server = await startRepo(t, sandbox.repo);

  const page = await fetch(`http://127.0.0.1:${server.port}/?token=${server.token}`);
  const html = await page.text();
  assert.match(html, /data-page="history"/);
  assert.match(html, /id="page-history" class="page" hidden/);
  assert.match(html, /id="history-refresh"/);
  assert.match(html, /id="history-limit"/);
  assert.match(html, /id="history-log"/);
  const script = await (await fetch(`http://127.0.0.1:${server.port}/app.js`)).text();
  assert.match(script, /async function loadHistory\(\)/);
  assert.match(script, /renderHistoryLog/);
  assert.match(script, /renderHistoryDrift/);

  const empty = await call(server, 'log');
  assert.equal(empty.status, 200);
  assert.equal(empty.data.ok, true);
  assert.equal(empty.data.result.total, 0);
  assert.deepEqual(empty.data.result.files, []);
  assert.equal(empty.data.result.limit, 50);
  assert.deepEqual(empty.data.result.deploy.targets, []);

  const deployNoConfirm = await call(server, 'deploy', { tool: 'qoder-cn', apply: true });
  assert.equal(deployNoConfirm.status, 403);
  const deployed = await call(server, 'deploy', { tool: 'qoder-cn', apply: true }, true);
  assert.equal(deployed.status, 200);
  assert.ok(deployed.data.result.log.recorded >= 1);
  assert.match(deployed.data.result.log.file, /^state\/logs\/deploy-\d{6}\.jsonl$/);

  const read = await call(server, 'content', {
    positionals: ['read', 'rule', '01-communication']
  });
  assert.equal(read.status, 200);
  const marker = 'GUI 历史页不应保存正文-HISTORY-BODY';
  const draft = `${read.data.result.content.trimEnd()}\n\n- ${marker}\n`;
  const saved = await call(server, 'content', {
    positionals: ['save', 'rule', '01-communication'],
    content: draft,
    apply: true,
    expectedFileHash: read.data.result.fileHash
  }, true);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.result.log.recorded, 1);

  const listed = await call(server, 'log', { limit: 10 });
  assert.equal(listed.status, 200);
  const log = listed.data.result;
  assert.equal(log.limit, 10);
  assert.equal(log.truncated, false);
  assert.ok(log.total >= 2);
  assert.equal(log.entries.every((entry) => entry.source === 'gui'), true);
  const actions = log.entries.map((entry) => entry.action);
  assert.equal(actions.includes('deploy'), true);
  assert.equal(actions.includes('content-save'), true);
  const contentEntry = log.entries.find((entry) => entry.action === 'content-save');
  assert.deepEqual(contentEntry.detail, {
    kind: 'rule',
    name: '01-communication',
    contentHash: saved.data.result.build.contentHash
  });
  assert.equal(log.deploy.targets.some((target) => target.tool === 'qoder-cn'), true);
  assert.ok(Array.isArray(log.deploy.projects));

  const logFile = path.join(sandbox.repo, 'state', 'logs', log.files[0].name);
  const raw = fs.readFileSync(logFile, 'utf8');
  assert.equal(raw.includes(marker), false);
  assert.equal(raw.split('\n').filter(Boolean).length, log.total);

  const rejectedApply = await call(server, 'log', { apply: true });
  assert.equal(rejectedApply.status, 400);
  assert.match(rejectedApply.data.error, /只读/);
  const rejectedDryRun = await call(server, 'log', { dryRun: true });
  assert.equal(rejectedDryRun.status, 400);

  for (const limit of [0, 1001, 'abc', 1.5]) {
    const rejected = await call(server, 'log', { limit });
    assert.equal(rejected.status, 400, `limit=${limit} 应被拒绝`);
    assert.match(rejected.data.error, /1 到 1000/);
  }
});

test('GUI 诊断页读取状态并生成 zip 诊断包', machineSkip, async (t) => {
  const sandbox = makeSandbox(t);
  const server = await startRepo(t, sandbox.repo);

  const page = await fetch(`http://127.0.0.1:${server.port}/?token=${server.token}`);
  const html = await page.text();
  assert.match(html, /data-page="diagnose"/);
  assert.match(html, /id="page-diagnose" class="page" hidden/);
  assert.match(html, /id="diagnose-refresh"/);
  assert.match(html, /id="diagnose-generate"[^>]*disabled/);
  assert.match(html, /id="diagnose-confirm"/);
  assert.match(html, /id="diagnose-result"/);
  assert.match(html, /本机路径与主机名/);
  const script = await (await fetch(`http://127.0.0.1:${server.port}/app.js`)).text();
  assert.match(script, /async function loadDiagnosePage\(\)/);
  assert.match(script, /async function generateDiagnose\(\)/);
  assert.match(script, /renderDiagnoseResult/);

  const secret = 'GUI-DIAG-SECRET-VALUE';
  const bodyMarker = 'GUI-DIAG-BODY-MARKER';
  const machineFile = path.join(sandbox.repo, 'machines', `${os.hostname()}.md`);
  fs.appendFileSync(
    machineFile,
    [
      '',
      '## 设置',
      '',
      '```json',
      JSON.stringify(
        { env: { AIWB_GUI_DIAG_SECRET: secret }, tools: {}, customTools: {} },
        null,
        2
      ),
      '```',
      ''
    ].join('\n'),
    'utf8'
  );
  const rulePath = path.join(sandbox.repo, 'content', 'rules', '01-communication.md');
  fs.appendFileSync(rulePath, `\n- ${bodyMarker}\n`, 'utf8');

  const deployed = await call(server, 'deploy', { tool: 'qoder-cn', apply: true }, true);
  assert.equal(deployed.status, 200);
  const preLog = await call(server, 'log');
  assert.equal(preLog.status, 200);
  assert.ok(preLog.data.result.total >= 1);
  const preDoctor = await call(server, 'doctor');
  assert.equal(preDoctor.status, 200);
  assert.equal(Array.isArray(preDoctor.data.result.checks), true);

  const noConfirm = await call(server, 'diagnose', { zip: true });
  assert.equal(noConfirm.status, 403);
  assert.match(noConfirm.data.error, /确认/);

  const noZip = await call(server, 'diagnose', {}, true);
  assert.equal(noZip.status, 403);
  assert.match(noZip.data.error, /zip/);

  const withApply = await call(server, 'diagnose', { zip: true, apply: true }, true);
  assert.equal(withApply.status, 400);
  const withDryRun = await call(server, 'diagnose', { zip: true, dryRun: true }, true);
  assert.equal(withDryRun.status, 400);

  const generated = await call(server, 'diagnose', { zip: true }, true);
  assert.equal(generated.status, 200, JSON.stringify(generated.data));
  const result = generated.data.result;
  assert.equal(result.ok, true);
  assert.match(result.outputDir, /^state\/diagnostics\/diagnose-\d{8}-\d{6}-\d{3}$/);
  assert.match(result.zip.path, /^state\/diagnostics\/diagnose-\d{8}-\d{6}-\d{3}\.zip$/);
  assert.equal(result.zip.entries, 6);
  assert.deepEqual(
    result.files.map((file) => file.name),
    ['README.md', 'summary.json', 'status.json', 'doctor.json', 'log.json', 'paths.json']
  );
  assert.equal(result.summary.machine.host, os.hostname());
  assert.equal(result.summary.paths.tools, 7);
  assert.ok(result.summary.log.total >= 1);
  assert.equal(result.summary.deploy.summary.ok >= 1, true);
  assert.equal(typeof result.health.ok, 'boolean');
  assert.equal(Array.isArray(result.issues), true);

  const zipPath = path.join(sandbox.repo, result.zip.path);
  assert.equal(fs.existsSync(zipPath), true);
  assert.equal(fs.statSync(zipPath).size, result.zip.bytes);
  assert.equal(fs.existsSync(path.join(sandbox.repo, result.outputDir, 'README.md')), true);
  const raw = fs.readFileSync(zipPath);
  for (const text of [secret, bodyMarker, 'AIWB_GUI_DIAG_SECRET']) {
    assert.equal(raw.includes(Buffer.from(text, 'utf8')), false, `zip 不应包含 ${text}`);
  }

  const after = await call(server, 'log');
  assert.equal(after.data.result.total, preLog.data.result.total, '诊断包不应写入操作日志');
});

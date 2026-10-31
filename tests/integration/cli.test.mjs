import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBlock } from '../../src/core/lib/merge-engine.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = path.join(repoRoot, 'src', 'cli', 'main.mjs');
const machineSkip = fs.existsSync(path.join(repoRoot, 'machines', `${os.hostname()}.md`))
  ? {}
  : { skip: '缺少本机机器档案，先按 machines/_template.md 创建 machines/<主机名>.md' };

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, AIWB_DEBUG: '' }
  });
}

function makeSandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-apply-'));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const globalRoot = path.join(root, 'global');

  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(path.join(home, '.qoder-cn'), { recursive: true });
  for (const dir of ['src', 'content', 'adapters']) {
    fs.cpSync(path.join(repoRoot, dir), path.join(repo, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(repoRoot, 'VERSION'), path.join(repo, 'VERSION'));

  fs.mkdirSync(path.join(repo, 'machines'), { recursive: true });
  const sourceMachine = path.join(repoRoot, 'machines', `${os.hostname()}.md`);
  const adjusted = fs
    .readFileSync(sourceMachine, 'utf8')
    .replace(/(- 全局工作台[：:])[^\r\n]*/, (match, prefix) => `${prefix}${globalRoot}`);
  fs.writeFileSync(
    path.join(repo, 'machines', `${os.hostname()}.md`),
    adjusted,
    'utf8'
  );

  t.after(() => {
    const linkPath = path.join(globalRoot, 'scripts', 'ai-workbench');
    try {
      if (fs.lstatSync(linkPath).isSymbolicLink()) {
        fs.rmSync(linkPath, { recursive: true, force: true });
      }
    } catch {
      // 链接可能不存在。
    }
    const skillsLink = path.join(home, '.qoder-cn', 'skills', 'aiwb');
    try {
      if (fs.lstatSync(skillsLink).isSymbolicLink()) {
        fs.unlinkSync(skillsLink);
      }
    } catch {
      // 技能链接可能不存在。
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  return {
    repo,
    home,
    globalRoot,
    entryPath: path.join(home, '.qoder-cn', 'AGENTS.md'),
    statePath: path.join(repo, 'state', 'deploy-state.json')
  };
}

function runSandboxCli(sandbox, args) {
  return spawnSync(
    process.execPath,
    [path.join(sandbox.repo, 'src', 'cli', 'main.mjs'), ...args],
    {
      cwd: sandbox.repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: sandbox.home,
        USERPROFILE: sandbox.home,
        AIWB_DEBUG: ''
      }
    }
  );
}

test('build 与 build --check 真实跑通', machineSkip, () => {
  const build = runCli(['build', '--json']);
  assert.equal(build.status, 0, build.stderr);
  const built = JSON.parse(build.stdout);
  assert.equal(built.mode, 'write');
  assert.equal(built.contentHash.startsWith('sha256:'), true);

  const check = runCli(['build', '--check', '--json']);
  assert.equal(check.status, 0, check.stderr);
  const checked = JSON.parse(check.stdout);
  assert.equal(checked.mode, 'check');
  assert.equal(checked.current, true);
});

test('deploy --dry-run 输出完整预演且不写外部文件', machineSkip, () => {
  const result = runCli(['deploy', '--dry-run', '--json']);
  assert.equal(result.status, 0, result.stderr);

  const data = JSON.parse(result.stdout);
  assert.equal(data.dryRun, true);
  assert.equal(data.targets.length, 7);
  assert.equal(data.summary.total, 7);
  assert.equal(data.summary.manual, 0);

  const allowed = new Set([
    'create-file',
    'append-block',
    'update-block',
    'unchanged',
    'manual',
    'skip-not-installed',
    'skip-unsupported',
    'skip-disabled'
  ]);
  for (const target of data.targets) {
    assert.equal(allowed.has(target.action), true, `${target.id} 动作未知：${target.action}`);
  }

  const qoder = data.targets.find((target) => target.id === 'qoder-cn');
  assert.ok(qoder);
  assert.match(qoder.entryPath, /\.qoder-cn[\\/]AGENTS\.md$/);
  assert.equal(qoder.deployedContentHash, null);
  assert.ok(data.global);
  assert.ok(data.global.linkPath);
  assert.equal(data.skills.applied, false);
  assert.equal(data.skills.skills.length, 1);
  assert.equal(data.skills.tools.length, 7);
  const qoderSkills = data.skills.tools.find((tool) => tool.id === 'qoder-cn');
  assert.ok(['create-directory', 'ready'].includes(qoderSkills.action));
  assert.ok(['create-junction', 'unchanged'].includes(qoderSkills.links[0].action));
});

test('deploy --apply 与 --dry-run 互斥', () => {
  const result = runCli(['deploy', '--apply', '--dry-run', '--json']);
  assert.equal(result.status, 1);
  const data = JSON.parse(result.stdout);
  assert.match(data.error, /不能同时使用/);
});

test('deploy --apply 新建入口并安装全局工作台，重复执行幂等', machineSkip, (t) => {
  const sandbox = makeSandbox(t);

  const first = runSandboxCli(sandbox, ['deploy', '--apply', '--json']);
  assert.equal(first.status, 0, first.stderr);
  const data = JSON.parse(first.stdout);
  assert.equal(data.applied, true);
  assert.equal(data.apply.ok, true);
  assert.equal(data.apply.written, 1);
  assert.equal(data.global.applied, true);

  const qoder = data.targets.find((target) => target.id === 'qoder-cn');
  assert.equal(qoder.applyStatus, 'written');
  assert.equal(qoder.action, 'create-file');

  const text = fs.readFileSync(sandbox.entryPath, 'utf8');
  assert.equal(findBlock(text).status, 'present');
  assert.equal(findBlock(text).blockHash, qoder.blockHash);

  const linkPath = path.join(sandbox.globalRoot, 'scripts', 'ai-workbench');
  assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
  assert.equal(
    path.resolve(fs.realpathSync(linkPath)),
    path.resolve(fs.realpathSync(path.join(sandbox.repo, 'content', 'scripts')))
  );
  for (const name of ['todo', 'scripts', 'notes', '_tmp']) {
    assert.equal(fs.statSync(path.join(sandbox.globalRoot, name)).isDirectory(), true, name);
  }

  assert.equal(data.skills.applied, true);
  assert.equal(data.skills.summary.create, 1);
  const skillsLink = path.join(sandbox.home, '.qoder-cn', 'skills', 'aiwb');
  assert.equal(fs.lstatSync(skillsLink).isSymbolicLink(), true);
  assert.equal(
    path.resolve(fs.realpathSync(skillsLink)),
    path.resolve(fs.realpathSync(path.join(sandbox.repo, 'content', 'skills', 'aiwb')))
  );

  const state = JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8'));
  assert.equal(state.targets['qoder-cn'].action, 'create-file');
  assert.equal(state.targets['qoder-cn'].blockHash, findBlock(text).blockHash);
  assert.equal(state.targets['qoder-cn'].backup, null);
  assert.match(state.lastRun, /^\d{4}-\d{2}-\d{2}T/);

  const second = runSandboxCli(sandbox, ['deploy', '--apply', '--json']);
  assert.equal(second.status, 0, second.stderr);
  const again = JSON.parse(second.stdout);
  assert.equal(again.apply.ok, true);
  assert.equal(again.apply.written, 0);
  assert.equal(again.apply.unchanged, 1);
  assert.equal(again.skills.summary.create, 0);
  assert.equal(again.skills.summary.unchanged, 1);
  assert.equal(fs.existsSync(path.join(sandbox.repo, 'state', 'backups')), false);

  const status = runSandboxCli(sandbox, ['status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  const statusData = JSON.parse(status.stdout);
  assert.equal(statusData.targets.find((target) => target.id === 'qoder-cn').state, 'ok');
  assert.equal(statusData.global.state, 'ok');
});

test('deploy --apply 追加到已有入口并写前备份，手改块后停止写入', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const existing = '# 用户规则\n\n- 保留我\n';
  fs.writeFileSync(sandbox.entryPath, existing, 'utf8');

  const first = runSandboxCli(sandbox, ['deploy', '--apply', '--json']);
  assert.equal(first.status, 0, first.stderr);
  const data = JSON.parse(first.stdout);
  const qoder = data.targets.find((target) => target.id === 'qoder-cn');
  assert.equal(qoder.action, 'append-block');
  assert.match(qoder.backup, /state\/backups\/qoder-cn\//);

  const after = fs.readFileSync(sandbox.entryPath, 'utf8');
  assert.ok(after.startsWith(existing));
  assert.equal(fs.readFileSync(path.join(sandbox.repo, qoder.backup, 'AGENTS.md'), 'utf8'), existing);

  const handEdited = after.replace(
    '<!-- AI-WORKBENCH:END -->',
    '手改一行\n<!-- AI-WORKBENCH:END -->'
  );
  fs.writeFileSync(sandbox.entryPath, handEdited, 'utf8');

  const blocked = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(blocked.status, 2, blocked.stderr);
  const blockedData = JSON.parse(blocked.stdout);
  assert.equal(blockedData.apply.written, 0);
  assert.equal(blockedData.summary.manual, 1);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), handEdited);
});

test('deploy --apply 遇全局冲突时不写任何文件', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const linkPath = path.join(sandbox.globalRoot, 'scripts', 'ai-workbench');
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.writeFileSync(linkPath, '不是链接', 'utf8');

  const result = runSandboxCli(sandbox, ['deploy', '--apply', '--json']);
  assert.equal(result.status, 1);
  const data = JSON.parse(result.stdout);
  assert.equal(data.apply.ok, false);
  assert.match(data.apply.reason, /冲突/);
  assert.equal(fs.existsSync(sandbox.entryPath), false);
  assert.equal(fs.existsSync(sandbox.statePath), false);
  assert.equal(fs.existsSync(path.join(sandbox.globalRoot, 'todo')), false);
});

test('deploy --apply --tool 只写指定入口，不创建全局工作台', machineSkip, (t) => {
  const sandbox = makeSandbox(t);

  const result = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.global, null);
  assert.equal(data.targets.length, 1);
  assert.equal(data.skills.tools.length, 1);
  assert.equal(fs.existsSync(sandbox.entryPath), true);
  assert.equal(fs.existsSync(sandbox.globalRoot), false);
});

test('deploy --apply 技能 junction 冲突时保留用户目录并继续入口部署', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const userSkill = path.join(sandbox.home, '.qoder-cn', 'skills', 'aiwb');
  fs.mkdirSync(userSkill, { recursive: true });
  fs.writeFileSync(path.join(userSkill, 'mine.md'), '用户自己的技能\n', 'utf8');

  const result = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.apply.ok, true);
  assert.equal(data.skills.ok, true);
  assert.equal(data.skills.applied, true);
  assert.equal(data.skills.summary.conflict, 1);
  assert.equal(data.skills.summary.create, 0);

  const qoder = data.skills.tools.find((tool) => tool.id === 'qoder-cn');
  assert.equal(qoder.applyStatus, 'skipped');
  assert.equal(qoder.links[0].applyStatus, 'skipped');
  assert.equal(fs.readFileSync(path.join(userSkill, 'mine.md'), 'utf8'), '用户自己的技能\n');
  assert.equal(fs.lstatSync(userSkill).isSymbolicLink(), false);
  assert.equal(fs.existsSync(sandbox.entryPath), true);
});

test('backup list 列出备份，restore 预演后恢复并可重复执行', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const existing = '# 用户规则\n\n- 保留我\n';
  fs.writeFileSync(sandbox.entryPath, existing, 'utf8');

  const empty = runSandboxCli(sandbox, ['backup', 'list', '--json']);
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout).backups, []);

  const deploy = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(deploy.status, 0, deploy.stderr);
  const deployed = JSON.parse(deploy.stdout);
  const qoder = deployed.targets.find((target) => target.id === 'qoder-cn');
  const stamp = path.basename(qoder.backup);

  const list = runSandboxCli(sandbox, ['backup', 'list', '--json']);
  assert.equal(list.status, 0, list.stderr);
  const listed = JSON.parse(list.stdout);
  assert.equal(listed.backups.length, 1);
  assert.equal(listed.backups[0].tool, 'qoder-cn');
  assert.equal(listed.backups[0].stamp, stamp);
  assert.equal(listed.backups[0].action, 'append-block');
  assert.equal(listed.backups[0].backupFileExists, true);
  assert.equal(listed.invalid.length, 0);

  const preview = runSandboxCli(sandbox, ['backup', 'restore', 'qoder-cn', stamp, '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const planned = JSON.parse(preview.stdout);
  assert.equal(planned.dryRun, true);
  assert.equal(planned.status, 'restore');
  assert.equal(planned.currentHash, JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8')).targets['qoder-cn'].fileHash);

  const applied = runSandboxCli(sandbox, [
    'backup',
    'restore',
    'qoder-cn',
    stamp,
    '--apply',
    '--json'
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const restored = JSON.parse(applied.stdout);
  assert.equal(restored.dryRun, false);
  assert.equal(restored.status, 'restored');
  assert.match(restored.safetyBackup, /state\/backups\/qoder-cn\//);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), existing);
  assert.equal(JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8')).targets['qoder-cn'], undefined);

  const status = runSandboxCli(sandbox, ['status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(
    JSON.parse(status.stdout).targets.find((target) => target.id === 'qoder-cn').state,
    'unmanaged'
  );

  const listAgain = runSandboxCli(sandbox, ['backup', 'list', '--json']);
  const listedAgain = JSON.parse(listAgain.stdout);
  assert.equal(listedAgain.backups.length, 2);
  assert.equal(listedAgain.backups.some((backup) => backup.action === 'restore-safety'), true);

  const again = runSandboxCli(sandbox, [
    'backup',
    'restore',
    'qoder-cn',
    stamp,
    '--apply',
    '--json'
  ]);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).status, 'unchanged');
  assert.equal(
    JSON.parse(runSandboxCli(sandbox, ['backup', 'list', '--json']).stdout).backups.length,
    2
  );
});

test('backup restore 遇到部署后手改的入口时阻止，--force 才覆盖', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const existing = '# 用户规则\n\n- 保留我\n';
  fs.writeFileSync(sandbox.entryPath, existing, 'utf8');

  const deploy = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(deploy.status, 0, deploy.stderr);
  const qoder = JSON.parse(deploy.stdout).targets.find((target) => target.id === 'qoder-cn');
  const stamp = path.basename(qoder.backup);

  const handEdited = `${fs.readFileSync(sandbox.entryPath, 'utf8')}手改一行\n`;
  fs.writeFileSync(sandbox.entryPath, handEdited, 'utf8');

  const blocked = runSandboxCli(sandbox, [
    'backup',
    'restore',
    'qoder-cn',
    stamp,
    '--apply',
    '--json'
  ]);
  assert.equal(blocked.status, 2, blocked.stderr);
  const blockedResult = JSON.parse(blocked.stdout);
  assert.equal(blockedResult.status, 'blocked');
  assert.equal(blockedResult.canForce, true);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), handEdited);

  const forced = runSandboxCli(sandbox, [
    'backup',
    'restore',
    'qoder-cn',
    stamp,
    '--apply',
    '--force',
    '--json'
  ]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(JSON.parse(forced.stdout).status, 'restored');
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), existing);
});

test('backup restore 恢复旧版块后标记待更新，可再次部署', machineSkip, (t) => {
  const sandbox = makeSandbox(t);

  const first = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(first.status, 0, first.stderr);
  const v1Text = fs.readFileSync(sandbox.entryPath, 'utf8');

  fs.appendFileSync(
    path.join(sandbox.repo, 'content', 'rules', '02-workflow.md'),
    '\n<!-- 触发内容版本变化 -->\n'
  );
  const second = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(second.status, 0, second.stderr);
  const updated = JSON.parse(second.stdout).targets.find((target) => target.id === 'qoder-cn');
  assert.equal(updated.action, 'update-block');
  const stamp = path.basename(updated.backup);
  assert.notEqual(fs.readFileSync(sandbox.entryPath, 'utf8'), v1Text);

  const restored = runSandboxCli(sandbox, [
    'backup',
    'restore',
    'qoder-cn',
    stamp,
    '--apply',
    '--json'
  ]);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(JSON.parse(restored.stdout).status, 'restored');
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), v1Text);

  const state = JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8'));
  assert.ok(state.targets['qoder-cn'].blockHash);
  assert.equal(state.targets['qoder-cn'].contentHash, null);

  const status = runSandboxCli(sandbox, ['status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(
    JSON.parse(status.stdout).targets.find((target) => target.id === 'qoder-cn').state,
    'stale'
  );

  const third = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(third.status, 0, third.stderr);
  const redeployed = JSON.parse(third.stdout);
  assert.equal(redeployed.apply.ok, true);
  assert.equal(redeployed.apply.written, 1);
  assert.equal(redeployed.targets.find((target) => target.id === 'qoder-cn').action, 'update-block');
});

test('backup restore --apply 遵守部署锁', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const existing = '# 用户规则\n\n- 保留我\n';
  fs.writeFileSync(sandbox.entryPath, existing, 'utf8');

  const deploy = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(deploy.status, 0, deploy.stderr);
  const qoder = JSON.parse(deploy.stdout).targets.find((target) => target.id === 'qoder-cn');
  const stamp = path.basename(qoder.backup);
  const deployedText = fs.readFileSync(sandbox.entryPath, 'utf8');

  const lockPath = path.join(sandbox.repo, 'state', 'locks', 'deploy.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(
    lockPath,
    `${JSON.stringify({ token: 'test', pid: 1, host: 'test', acquiredAt: new Date().toISOString() })}\n`,
    'utf8'
  );

  const blocked = runSandboxCli(sandbox, [
    'backup',
    'restore',
    'qoder-cn',
    stamp,
    '--apply',
    '--json'
  ]);
  assert.equal(blocked.status, 1);
  assert.match(JSON.parse(blocked.stdout).error, /部署锁/);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), deployedText);
});

test('backup 参数错误时给出明确提示', machineSkip, (t) => {
  const sandbox = makeSandbox(t);

  const unknownTool = runSandboxCli(sandbox, ['backup', 'list', '--tool', 'nope', '--json']);
  assert.equal(unknownTool.status, 1);
  assert.match(JSON.parse(unknownTool.stdout).error, /未知目标/);

  const badStamp = runSandboxCli(sandbox, ['backup', 'restore', 'qoder-cn', '..', '--json']);
  assert.equal(badStamp.status, 1);
  assert.match(JSON.parse(badStamp.stdout).error, /时间戳/);

  const missing = runSandboxCli(sandbox, ['backup', 'restore', 'qoder-cn', '20260101-000000-000', '--json']);
  assert.equal(missing.status, 1);
  assert.match(JSON.parse(missing.stdout).error, /找不到备份/);
});

test('content lint 通过且脚手架预演不落盘', machineSkip, () => {
  const lint = runCli(['content', 'lint', '--json']);
  assert.equal(lint.status, 0, lint.stderr);
  const linted = JSON.parse(lint.stdout);
  assert.equal(linted.ok, true);
  assert.equal(linted.skills.some((skill) => skill.name === 'aiwb' && skill.builtin), true);

  const dry = runCli(['content', 'new-rule', 'tmp-check', '--dry-run', '--json']);
  assert.equal(dry.status, 0, dry.stderr);
  const created = JSON.parse(dry.stdout);
  assert.equal(created.dryRun, true);
  assert.equal(fs.existsSync(path.join(repoRoot, created.file)), false);

  const doctor = runCli(['doctor', '--json']);
  assert.equal(doctor.status, 0, doctor.stderr);
  const contentCheck = JSON.parse(doctor.stdout).checks.find((check) => check.id === 'content');
  assert.equal(contentCheck.status, 'pass');
});

test('status 与 doctor --parity 可读取', machineSkip, () => {
  const status = runCli(['status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  const statusData = JSON.parse(status.stdout);
  assert.equal(statusData.targets.length, 7);

  const doctor = runCli(['doctor', '--parity', '--json']);
  assert.equal(doctor.status, 0, doctor.stderr);
  const doctorData = JSON.parse(doctor.stdout);
  assert.equal(doctorData.checks.length, 1);
  assert.equal(doctorData.checks[0].id, 'parity');
  assert.ok(['pass', 'pending'].includes(doctorData.checks[0].status));
});

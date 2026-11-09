import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBlock, replaceBlock, wrapBlock } from '../../src/core/lib/merge-engine.mjs';
import { parseSettingsText } from '../../src/core/lib/settings.mjs';

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
  const projectsRoot = path.join(root, 'projects');

  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(path.join(home, '.qoder-cn'), { recursive: true });
  fs.mkdirSync(projectsRoot, { recursive: true });
  for (const dir of ['src', 'content', 'adapters']) {
    fs.cpSync(path.join(repoRoot, dir), path.join(repo, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(repoRoot, 'VERSION'), path.join(repo, 'VERSION'));

  fs.mkdirSync(path.join(repo, 'machines'), { recursive: true });
  const sourceMachine = path.join(repoRoot, 'machines', `${os.hostname()}.md`);
  const adjusted = fs
    .readFileSync(sourceMachine, 'utf8')
    .replace(/\r?\n##[ \t]+设置[ \t]*\r?\n[\s\S]*?(?=\r?\n##[ \t]+|$)/, '')
    .replace(/(- 全局工作台[：:])[^\r\n]*/, (match, prefix) => `${prefix}${globalRoot}`)
    .replace(/(- 项目父级[：:])[^\r\n]*/, (match, prefix) => `${prefix}${projectsRoot}`)
    .replace(/^\|[^\n]*\|[A-Za-z]:\\[^\n]*$/gm, '');
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
    projectsRoot,
    entryPath: path.join(home, '.qoder-cn', 'AGENTS.md'),
    statePath: path.join(repo, 'state', 'deploy-state.json')
  };
}

function initProject(sandbox, name) {
  const projectPath = path.join(sandbox.projectsRoot, name);
  fs.mkdirSync(projectPath, { recursive: true });
  const init = spawnSync('git', ['init', '--quiet', projectPath], { encoding: 'utf8' });
  if (init.error) throw init.error;
  return projectPath;
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
    'insert-block',
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
  assert.ok(
    qoder.deployedContentHash === null || /^sha256:[0-9a-f]{64}$/.test(qoder.deployedContentHash)
  );
  assert.ok(data.global);
  assert.ok(data.global.linkPath);
  assert.equal(data.skills.applied, false);
  assert.equal(data.skills.skills.length, 2);
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
  assert.equal(data.skills.summary.create, 2);
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
  assert.equal(again.skills.summary.unchanged, 2);
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

test('deploy --apply 记忆注入写入区块与拆分文件，卸载可还原', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const configRoot = path.join(sandbox.home, '.workbuddy');
  const uid = '11111111-2222-3333-4444-555555555555';
  const memoryPath = path.join(configRoot, `user-${uid}-personal`, 'MEMORY.md');
  const splitPath = path.join(configRoot, 'memory', 'ai-workbench-global-rules.md');
  const snapshotPath = path.join(configRoot, 'storage', 'skeleton', 'account-snapshot.json');
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  const original = `# 我的记忆\n\n${'x'.repeat(4000)}\n`;
  fs.writeFileSync(memoryPath, original, 'utf8');
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify({
      primary: { version: 1, uid, nickname: '测试账号', type: 'personal', savedAt: Date.now() }
    }),
    'utf8'
  );

  const previewRun = runSandboxCli(sandbox, [
    'deploy',
    '--tool',
    'workbuddy',
    '--dry-run',
    '--json'
  ]);
  assert.equal(previewRun.status, 0, previewRun.stderr);
  const preview = JSON.parse(previewRun.stdout);
  const planned = preview.targets[0];
  assert.equal(planned.action, 'insert-block');
  assert.equal(planned.memoryMode, 'hook');
  assert.equal(planned.splitAction, 'create');
  assert.equal(planned.entryPath, memoryPath);
  assert.equal(planned.splitFilePath, splitPath);
  assert.ok(planned.blockChars <= 600);
  assert.ok(planned.totalChars > 4000);
  assert.ok(planned.totalNonWhitespaceChars < planned.totalChars);
  assert.ok(planned.totalBytes > planned.totalChars);
  assert.ok(planned.totalWords > 0);
  assert.ok(planned.warnings.length >= 1);

  const applyRun = runSandboxCli(sandbox, ['deploy', '--tool', 'workbuddy', '--apply', '--json']);
  assert.equal(applyRun.status, 0, applyRun.stderr);
  const applied = JSON.parse(applyRun.stdout);
  assert.equal(applied.apply.ok, true);
  assert.equal(applied.apply.written, 1);

  const memoryBuffer = fs.readFileSync(memoryPath);
  const memoryText = memoryBuffer.toString('utf8');
  assert.equal(memoryBuffer.length, planned.totalBytes);
  assert.equal(memoryBuffer[0] === 0xef, false);
  assert.equal(memoryText.startsWith('<!-- USER-GLOBAL-RULES:BEGIN -->'), true);
  assert.equal(memoryText.endsWith(original), true);
  assert.equal(memoryText.includes('\r'), false);

  const splitText = fs.readFileSync(splitPath, 'utf8');
  assert.equal(splitText.startsWith('# AI 工作台全局规则\n'), true);
  assert.equal(splitText.includes('\r'), false);

  const state = JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8'));
  assert.equal(state.targets.workbuddy.memoryMode, 'hook');
  assert.equal(state.targets.workbuddy.splitFilePath, splitPath);
  assert.match(state.targets.workbuddy.splitFileHash, /^sha256:/);

  const statusRun = runSandboxCli(sandbox, ['status', '--json']);
  assert.equal(statusRun.status, 0, statusRun.stderr);
  const status = JSON.parse(statusRun.stdout);
  assert.equal(
    status.targets.find((target) => target.id === 'workbuddy').state,
    'ok'
  );

  const doctorRun = runSandboxCli(sandbox, ['doctor', '--json']);
  const memoryCheck = JSON.parse(doctorRun.stdout).checks.find(
    (check) => check.id === 'memory'
  );
  assert.equal(memoryCheck.status, 'pending');
  assert.match(memoryCheck.detail, /^WorkBuddy 记忆文件 \d+ 字符，超过每会话注入上限 4000/);
  assert.match(memoryCheck.detail, /不含空白 \d+/);
  assert.match(memoryCheck.detail, new RegExp(`文件 ${memoryBuffer.length} 字节`));
  assert.match(memoryCheck.detail, /字数 \d+/);
  assert.equal(memoryCheck.detail.includes('Qoder'), false);

  const secondRun = runSandboxCli(sandbox, [
    'deploy',
    '--tool',
    'workbuddy',
    '--dry-run',
    '--json'
  ]);
  const second = JSON.parse(secondRun.stdout);
  assert.equal(second.targets[0].action, 'unchanged');
  assert.equal(second.targets[0].splitAction, 'none');

  const uninstallPreview = runSandboxCli(sandbox, ['uninstall', '--tool', 'workbuddy', '--json']);
  assert.equal(uninstallPreview.status, 0, uninstallPreview.stderr);
  const uninstallPlan = JSON.parse(uninstallPreview.stdout);
  assert.equal(uninstallPlan.targets[0].status, 'remove-block');
  assert.equal(uninstallPlan.summary.splitRemove, 1);

  const uninstallRun = runSandboxCli(sandbox, [
    'uninstall',
    '--tool',
    'workbuddy',
    '--apply',
    '--json'
  ]);
  assert.equal(uninstallRun.status, 0, uninstallRun.stderr);
  const uninstalled = JSON.parse(uninstallRun.stdout);
  assert.equal(uninstalled.apply.removedBlocks, 1);
  assert.equal(fs.readFileSync(memoryPath, 'utf8'), original);
  assert.equal(fs.existsSync(splitPath), false);

  const afterState = JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8'));
  assert.equal(afterState.targets.workbuddy, undefined);
  const afterStatus = JSON.parse(runSandboxCli(sandbox, ['status', '--json']).stdout);
  assert.equal(
    afterStatus.targets.find((target) => target.id === 'workbuddy').state,
    'unmanaged'
  );

  fs.writeFileSync(memoryPath, '# 我的记忆\n\n短内容\n', 'utf8');
  const smallDoctor = JSON.parse(runSandboxCli(sandbox, ['doctor', '--json']).stdout);
  const smallMemoryCheck = smallDoctor.checks.find((check) => check.id === 'memory');
  assert.equal(smallMemoryCheck.status, 'pass');
  assert.match(
    smallMemoryCheck.detail,
    /^WorkBuddy \d+\/4000（不含空白 \d+，文件 \d+ 字节，字数 \d+）$/
  );
});

test('账号快照有效时记忆注入写入账号目录，设备根保持不变', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const configRoot = path.join(sandbox.home, '.workbuddy');
  const uid = '11111111-2222-3333-4444-555555555555';
  const accountMemory = path.join(configRoot, `user-${uid}-personal`, 'MEMORY.md');
  const rootMemory = path.join(configRoot, 'MEMORY.md');
  const splitPath = path.join(configRoot, 'memory', 'ai-workbench-global-rules.md');
  const snapshotPath = path.join(
    configRoot,
    'storage',
    'skeleton',
    'account-snapshot.json'
  );
  const original = `# 账号记忆\n\n${'x'.repeat(4000)}\n`;
  const rootOriginal = '# 设备根记忆\n';

  fs.mkdirSync(path.dirname(accountMemory), { recursive: true });
  fs.writeFileSync(accountMemory, original, 'utf8');
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        primary: {
          version: 1,
          uid,
          nickname: '测试账号',
          type: 'personal',
          savedAt: Date.now()
        }
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(rootMemory, rootOriginal, 'utf8');

  const previewRun = runSandboxCli(sandbox, [
    'deploy',
    '--tool',
    'workbuddy',
    '--dry-run',
    '--json'
  ]);
  assert.equal(previewRun.status, 0, previewRun.stderr);
  const planned = JSON.parse(previewRun.stdout).targets[0];
  assert.equal(planned.entryPathSource, 'account');
  assert.equal(planned.entryPathProblem, null);
  assert.equal(planned.entryPath, accountMemory);
  assert.equal(planned.splitFilePath, splitPath);
  assert.equal(planned.action, 'insert-block');
  assert.equal(planned.memoryMode, 'hook');

  const applyRun = runSandboxCli(sandbox, ['deploy', '--tool', 'workbuddy', '--apply', '--json']);
  assert.equal(applyRun.status, 0, applyRun.stderr);
  const applied = JSON.parse(applyRun.stdout);
  assert.equal(applied.apply.ok, true);
  assert.equal(applied.apply.written, 1);

  const memoryText = fs.readFileSync(accountMemory, 'utf8');
  assert.equal(memoryText.startsWith('<!-- USER-GLOBAL-RULES:BEGIN -->'), true);
  assert.equal(memoryText.endsWith(original), true);
  assert.equal(fs.readFileSync(splitPath, 'utf8').startsWith('# AI 工作台全局规则\n'), true);
  assert.equal(fs.readFileSync(rootMemory, 'utf8'), rootOriginal);

  const state = JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8'));
  assert.equal(state.targets.workbuddy.entryPath, accountMemory);

  const status = JSON.parse(runSandboxCli(sandbox, ['status', '--json']).stdout);
  assert.equal(
    status.targets.find((target) => target.id === 'workbuddy').state,
    'ok'
  );

  const secondRun = JSON.parse(
    runSandboxCli(sandbox, ['deploy', '--tool', 'workbuddy', '--dry-run', '--json']).stdout
  );
  assert.equal(secondRun.targets[0].action, 'unchanged');
  assert.equal(secondRun.targets[0].splitAction, 'none');

  const uninstallRun = runSandboxCli(sandbox, [
    'uninstall',
    '--tool',
    'workbuddy',
    '--apply',
    '--json'
  ]);
  assert.equal(uninstallRun.status, 0, uninstallRun.stderr);
  const uninstalled = JSON.parse(uninstallRun.stdout);
  assert.equal(uninstalled.apply.removedBlocks, 1);
  assert.equal(fs.readFileSync(accountMemory, 'utf8'), original);
  assert.equal(fs.existsSync(splitPath), false);
  assert.equal(fs.readFileSync(rootMemory, 'utf8'), rootOriginal);
});

test('疑似登出时部署按需人工阻止，不写设备根', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const configRoot = path.join(sandbox.home, '.workbuddy');
  const uid = '11111111-2222-3333-4444-555555555555';
  const accountMemory = path.join(configRoot, `user-${uid}-personal`, 'MEMORY.md');
  const rootMemory = path.join(configRoot, 'MEMORY.md');
  const splitPath = path.join(configRoot, 'memory', 'ai-workbench-global-rules.md');
  const original = '# 账号记忆\n';
  const rootOriginal = '# 设备根记忆\n';

  fs.mkdirSync(path.dirname(accountMemory), { recursive: true });
  fs.writeFileSync(accountMemory, original, 'utf8');
  fs.writeFileSync(rootMemory, rootOriginal, 'utf8');

  const previewRun = runSandboxCli(sandbox, [
    'deploy',
    '--tool',
    'workbuddy',
    '--dry-run',
    '--json'
  ]);
  assert.equal(previewRun.status, 2, previewRun.stderr);
  const planned = JSON.parse(previewRun.stdout).targets[0];
  assert.equal(planned.entryPathSource, 'device-root');
  assert.equal(planned.entryPathBlocked, true);
  assert.match(planned.entryPathProblem, /疑似 WorkBuddy 已登出/);
  assert.equal(planned.action, 'manual');
  assert.equal(planned.entryPath, rootMemory);

  const applyRun = runSandboxCli(sandbox, ['deploy', '--tool', 'workbuddy', '--apply', '--json']);
  assert.equal(applyRun.status, 2, applyRun.stderr);
  const applied = JSON.parse(applyRun.stdout);
  assert.equal(applied.apply.ok, true);
  assert.equal(applied.apply.written, 0);
  assert.equal(applied.summary.manual, 1);
  assert.equal(fs.readFileSync(rootMemory, 'utf8'), rootOriginal);
  assert.equal(fs.readFileSync(accountMemory, 'utf8'), original);
  assert.equal(fs.existsSync(splitPath), false);

  const state = JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8'));
  assert.equal(state.targets.workbuddy, undefined);

  const detect = JSON.parse(runSandboxCli(sandbox, ['detect', '--json']).stdout);
  const detected = detect.tools.find((tool) => tool.id === 'workbuddy');
  assert.equal(detected.entryPathBlocked, true);
  assert.match(detected.entryPathProblem, /疑似 WorkBuddy 已登出/);
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
  assert.equal(data.skills.summary.create, 1);

  const qoder = data.skills.tools.find((tool) => tool.id === 'qoder-cn');
  assert.equal(qoder.applyStatus, 'created');
  assert.equal(qoder.links[0].applyStatus, 'skipped');
  assert.equal(fs.readFileSync(path.join(userSkill, 'mine.md'), 'utf8'), '用户自己的技能\n');
  assert.equal(fs.lstatSync(userSkill).isSymbolicLink(), false);
  assert.equal(fs.existsSync(sandbox.entryPath), true);
});

test('uninstall 预演不写文件，--apply 移除块并保留用户内容与备份', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const existing = '# 用户规则\n\n- 保留我\n';
  fs.writeFileSync(sandbox.entryPath, existing, 'utf8');

  const deploy = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(deploy.status, 0, deploy.stderr);
  const deployedText = fs.readFileSync(sandbox.entryPath, 'utf8');
  const skillsLink = path.join(sandbox.home, '.qoder-cn', 'skills', 'aiwb');
  assert.equal(fs.lstatSync(skillsLink).isSymbolicLink(), true);

  const preview = runSandboxCli(sandbox, ['uninstall', '--tool', 'qoder-cn', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const planned = JSON.parse(preview.stdout);
  assert.equal(planned.dryRun, true);
  assert.equal(planned.summary.removeBlock, 1);
  assert.equal(planned.summary.skillsRemove, 2);
  assert.equal(planned.global, null);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), deployedText);
  assert.equal(fs.lstatSync(skillsLink).isSymbolicLink(), true);

  const applied = runSandboxCli(sandbox, [
    'uninstall',
    '--tool',
    'qoder-cn',
    '--apply',
    '--json'
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.dryRun, false);
  assert.equal(result.applied, true);
  assert.equal(result.apply.removedBlocks, 1);
  assert.equal(result.apply.skillsRemoved, 2);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), existing);
  assert.throws(() => fs.lstatSync(skillsLink), /ENOENT/);
  assert.equal(
    fs.existsSync(path.join(sandbox.repo, 'content', 'skills', 'aiwb', 'SKILL.md')),
    true
  );

  const state = JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8'));
  assert.equal(state.targets['qoder-cn'], undefined);

  const qoder = result.targets.find((target) => target.id === 'qoder-cn');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(sandbox.repo, qoder.backup, 'manifest.json'), 'utf8')
  );
  assert.equal(manifest.action, 'uninstall-safety');
  assert.equal(
    fs.readdirSync(path.join(sandbox.repo, 'state', 'backups', 'qoder-cn')).length,
    2
  );
});

test('uninstall 删除工作台创建且部署后未修改的入口文件', machineSkip, (t) => {
  const sandbox = makeSandbox(t);

  const deploy = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(deploy.status, 0, deploy.stderr);
  const qoder = JSON.parse(deploy.stdout).targets.find((target) => target.id === 'qoder-cn');
  assert.equal(qoder.action, 'create-file');
  assert.equal(fs.existsSync(sandbox.entryPath), true);

  const preview = runSandboxCli(sandbox, ['uninstall', '--tool', 'qoder-cn', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const planned = JSON.parse(preview.stdout);
  assert.equal(planned.summary.deleteFile, 1);
  assert.equal(fs.existsSync(sandbox.entryPath), true);

  const applied = runSandboxCli(sandbox, [
    'uninstall',
    '--tool',
    'qoder-cn',
    '--apply',
    '--json'
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).apply.deleted, 1);
  assert.equal(fs.existsSync(sandbox.entryPath), false);
  assert.equal(fs.readdirSync(path.join(sandbox.repo, 'state', 'backups', 'qoder-cn')).length, 1);

  const again = runSandboxCli(sandbox, ['uninstall', '--tool', 'qoder-cn', '--json']);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).summary.absent, 1);
});

test('uninstall 遇到手改块时阻止，--force 才移除并保留文件', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const existing = '# 用户规则\n\n- 保留我\n';
  fs.writeFileSync(sandbox.entryPath, existing, 'utf8');

  const deploy = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(deploy.status, 0, deploy.stderr);
  const handEdited = fs
    .readFileSync(sandbox.entryPath, 'utf8')
    .replace('<!-- AI-WORKBENCH:END -->', '手改一行\n<!-- AI-WORKBENCH:END -->');
  fs.writeFileSync(sandbox.entryPath, handEdited, 'utf8');

  const blocked = runSandboxCli(sandbox, ['uninstall', '--tool', 'qoder-cn', '--json']);
  assert.equal(blocked.status, 2, blocked.stderr);
  const blockedData = JSON.parse(blocked.stdout);
  assert.equal(blockedData.summary.blocked, 1);
  assert.equal(blockedData.targets[0].canForce, true);

  const blockedApply = runSandboxCli(sandbox, [
    'uninstall',
    '--tool',
    'qoder-cn',
    '--apply',
    '--json'
  ]);
  assert.equal(blockedApply.status, 2, blockedApply.stderr);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), handEdited);

  const forced = runSandboxCli(sandbox, [
    'uninstall',
    '--tool',
    'qoder-cn',
    '--apply',
    '--force',
    '--json'
  ]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(JSON.parse(forced.stdout).apply.removedBlocks, 1);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), existing);
});

test('uninstall 遇到无部署记录的块时阻止，--force 只移除块', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const existing = '# 用户规则\n\n- 保留我\n';
  fs.writeFileSync(sandbox.entryPath, existing, 'utf8');

  const deploy = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(deploy.status, 0, deploy.stderr);

  const state = JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8'));
  delete state.targets['qoder-cn'];
  fs.writeFileSync(sandbox.statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const blocked = runSandboxCli(sandbox, ['uninstall', '--tool', 'qoder-cn', '--json']);
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.match(JSON.parse(blocked.stdout).targets[0].reason, /部署记录/);

  const forced = runSandboxCli(sandbox, [
    'uninstall',
    '--tool',
    'qoder-cn',
    '--apply',
    '--force',
    '--json'
  ]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), existing);
});

test('uninstall 保留用户同名技能目录', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const deploy = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(deploy.status, 0, deploy.stderr);

  const skillsLink = path.join(sandbox.home, '.qoder-cn', 'skills', 'aiwb');
  fs.unlinkSync(skillsLink);
  fs.mkdirSync(skillsLink, { recursive: true });
  fs.writeFileSync(path.join(skillsLink, 'mine.md'), '用户自己的技能\n', 'utf8');

  const preview = runSandboxCli(sandbox, ['uninstall', '--tool', 'qoder-cn', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).summary.skillsConflict, 1);

  const applied = runSandboxCli(sandbox, [
    'uninstall',
    '--tool',
    'qoder-cn',
    '--apply',
    '--json'
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fs.existsSync(path.join(skillsLink, 'mine.md')), true);
  assert.equal(fs.lstatSync(skillsLink).isSymbolicLink(), false);
});

test('uninstall 全量移除入口、技能与全局脚本 junction，保留目录和备份', machineSkip, (t) => {
  const sandbox = makeSandbox(t);

  const deploy = runSandboxCli(sandbox, ['deploy', '--apply', '--json']);
  assert.equal(deploy.status, 0, deploy.stderr);
  const globalLink = path.join(sandbox.globalRoot, 'scripts', 'ai-workbench');
  const skillsLink = path.join(sandbox.home, '.qoder-cn', 'skills', 'aiwb');
  assert.equal(fs.lstatSync(globalLink).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(skillsLink).isSymbolicLink(), true);

  const preview = runSandboxCli(sandbox, ['uninstall', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const planned = JSON.parse(preview.stdout);
  assert.equal(planned.dryRun, true);
  assert.equal(planned.summary.deleteFile, 1);
  assert.equal(planned.summary.skillsRemove, 2);
  assert.equal(planned.summary.globalRemove, 1);
  assert.equal(planned.global.status, 'remove-junction');
  assert.equal(fs.existsSync(sandbox.entryPath), true);
  assert.equal(fs.lstatSync(globalLink).isSymbolicLink(), true);

  const applied = runSandboxCli(sandbox, ['uninstall', '--apply', '--json']);
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.apply.deleted, 1);
  assert.equal(result.apply.skillsRemoved, 2);
  assert.equal(result.apply.globalRemoved, 1);
  assert.equal(fs.existsSync(sandbox.entryPath), false);
  assert.throws(() => fs.lstatSync(globalLink), /ENOENT/);
  assert.throws(() => fs.lstatSync(skillsLink), /ENOENT/);
  for (const name of ['todo', 'scripts', 'notes', '_tmp']) {
    assert.equal(fs.statSync(path.join(sandbox.globalRoot, name)).isDirectory(), true, name);
  }
  const state = JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8'));
  assert.deepEqual(state.targets, {});
  assert.equal(fs.existsSync(path.join(sandbox.repo, 'state', 'backups', 'qoder-cn')), true);

  const again = runSandboxCli(sandbox, ['uninstall', '--json']);
  assert.equal(again.status, 0, again.stderr);
  const againData = JSON.parse(again.stdout);
  assert.equal(againData.summary.absent, againData.targets.length);
  assert.equal(againData.global.status, 'absent');
});

test('uninstall 写操作遵守部署锁', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  fs.writeFileSync(sandbox.entryPath, '# 用户规则\n', 'utf8');
  const deploy = runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']);
  assert.equal(deploy.status, 0, deploy.stderr);
  const deployedText = fs.readFileSync(sandbox.entryPath, 'utf8');

  const lockPath = path.join(sandbox.repo, 'state', 'locks', 'deploy.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(
    lockPath,
    `${JSON.stringify({ token: 'test', pid: 1, host: 'test', acquiredAt: new Date().toISOString() })}\n`,
    'utf8'
  );

  const preview = runSandboxCli(sandbox, ['uninstall', '--tool', 'qoder-cn', '--json']);
  assert.equal(preview.status, 0, preview.stderr);

  const blocked = runSandboxCli(sandbox, [
    'uninstall',
    '--tool',
    'qoder-cn',
    '--apply',
    '--json'
  ]);
  assert.equal(blocked.status, 1);
  assert.match(JSON.parse(blocked.stdout).error, /部署锁/);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), deployedText);
});

test('uninstall 参数错误时给出明确提示', machineSkip, (t) => {
  const sandbox = makeSandbox(t);

  const unknownTool = runSandboxCli(sandbox, ['uninstall', '--tool', 'nope', '--json']);
  assert.equal(unknownTool.status, 1);
  assert.match(JSON.parse(unknownTool.stdout).error, /未知目标/);

  const both = runSandboxCli(sandbox, ['uninstall', '--apply', '--dry-run', '--json']);
  assert.equal(both.status, 1);
  assert.match(JSON.parse(both.stdout).error, /不能同时使用/);
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

test('backup create 主动备份现有入口且不改动入口文件', machineSkip, (t) => {
  const sandbox = makeSandbox(t);

  const empty = runSandboxCli(sandbox, ['backup', 'create', '--json']);
  assert.equal(empty.status, 0, empty.stderr);
  const emptyResult = JSON.parse(empty.stdout);
  assert.equal(emptyResult.summary.created, 0);
  assert.equal(emptyResult.summary.missing, 7);
  assert.equal(emptyResult.summary.failed, 0);
  assert.equal(fs.existsSync(path.join(sandbox.repo, 'state', 'backups')), false);

  const existing = '# 用户规则\n\n- 保留我\n';
  fs.writeFileSync(sandbox.entryPath, existing, 'utf8');

  const createdRun = runSandboxCli(sandbox, ['backup', 'create', '--json']);
  assert.equal(createdRun.status, 0, createdRun.stderr);
  const created = JSON.parse(createdRun.stdout);
  assert.equal(created.subcommand, 'create');
  assert.equal(created.summary.created, 1);
  assert.equal(created.summary.missing, 6);
  assert.equal(created.ok, true);

  const qoder = created.tools.find((tool) => tool.id === 'qoder-cn');
  assert.equal(qoder.status, 'created');
  assert.match(qoder.backup, /state\/backups\/qoder-cn\//);
  assert.equal(fs.readFileSync(path.join(sandbox.repo, qoder.backup, 'AGENTS.md'), 'utf8'), existing);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), existing);

  const listed = JSON.parse(runSandboxCli(sandbox, ['backup', 'list', '--json']).stdout);
  assert.equal(listed.backups.length, 1);
  assert.equal(listed.backups[0].action, 'manual');
  assert.equal(listed.backups[0].stamp, path.basename(qoder.backup));
  assert.equal(listed.backups[0].backupFileExists, true);

  const preview = runSandboxCli(sandbox, [
    'backup',
    'restore',
    'qoder-cn',
    listed.backups[0].stamp,
    '--json'
  ]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).status, 'unchanged');

  const oneTool = runSandboxCli(sandbox, ['backup', 'create', '--tool', 'qoder-cn', '--json']);
  assert.equal(oneTool.status, 0, oneTool.stderr);
  const oneToolResult = JSON.parse(oneTool.stdout);
  assert.equal(oneToolResult.summary.created, 1);
  assert.equal(oneToolResult.summary.missing, 0);
  assert.equal(JSON.parse(runSandboxCli(sandbox, ['backup', 'list', '--json']).stdout).backups.length, 2);
});

test('backup prune 按保留份数清理旧备份且默认预演', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const machinePath = path.join(sandbox.repo, 'machines', `${os.hostname()}.md`);
  fs.writeFileSync(
    machinePath,
    fs
      .readFileSync(machinePath, 'utf8')
      .replace(/backupRetention:\s*\d+/, 'backupRetention: 2'),
    'utf8'
  );

  fs.writeFileSync(sandbox.entryPath, '# 用户规则\n\n- 保留我\n', 'utf8');
  for (let index = 0; index < 4; index += 1) {
    const created = runSandboxCli(sandbox, ['backup', 'create', '--tool', 'qoder-cn', '--json']);
    assert.equal(created.status, 0, created.stderr);
  }

  const qoderRoot = path.join(sandbox.repo, 'state', 'backups', 'qoder-cn');
  const invalidDir = path.join(qoderRoot, '00000000-000000-000');
  fs.mkdirSync(invalidDir, { recursive: true });

  const previewRun = runSandboxCli(sandbox, ['backup', 'prune', '--json']);
  assert.equal(previewRun.status, 0, previewRun.stderr);
  const preview = JSON.parse(previewRun.stdout);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.keep, 2);
  assert.equal(preview.keepSource, 'machine');
  assert.equal(preview.summary.total, 5);
  assert.equal(preview.summary.kept, 2);
  assert.equal(preview.summary.delete, 2);
  assert.equal(preview.summary.deleted, 0);
  assert.equal(preview.summary.skipped, 1);
  assert.equal(preview.summary.failed, 0);

  const keepStamps = preview.items
    .filter((item) => item.status === 'keep')
    .map((item) => item.stamp)
    .sort();
  const deleteStamps = preview.items
    .filter((item) => item.status === 'delete')
    .map((item) => item.stamp)
    .sort();
  assert.equal(keepStamps.length, 2);
  assert.equal(deleteStamps.length, 2);
  for (const stamp of deleteStamps) {
    assert.equal(fs.existsSync(path.join(qoderRoot, stamp)), true);
  }
  assert.equal(
    preview.items.find((item) => item.stamp === '00000000-000000-000').status,
    'skipped'
  );
  assert.equal(fs.existsSync(invalidDir), true);

  const appliedRun = runSandboxCli(sandbox, ['backup', 'prune', '--apply', '--json']);
  assert.equal(appliedRun.status, 0, appliedRun.stderr);
  const applied = JSON.parse(appliedRun.stdout);
  assert.equal(applied.dryRun, false);
  assert.equal(applied.summary.delete, 2);
  assert.equal(applied.summary.deleted, 2);
  assert.equal(applied.summary.failed, 0);
  for (const stamp of deleteStamps) {
    assert.equal(fs.existsSync(path.join(qoderRoot, stamp)), false);
  }
  assert.equal(fs.existsSync(invalidDir), true);

  const remaining = JSON.parse(
    runSandboxCli(sandbox, ['backup', 'list', '--tool', 'qoder-cn', '--json']).stdout
  );
  assert.deepEqual(remaining.backups.map((backup) => backup.stamp).sort(), keepStamps);

  const againRun = runSandboxCli(sandbox, ['backup', 'prune', '--apply', '--json']);
  assert.equal(againRun.status, 0, againRun.stderr);
  assert.equal(JSON.parse(againRun.stdout).summary.delete, 0);

  const overrideRun = runSandboxCli(sandbox, ['backup', 'prune', '--keep', '3', '--json']);
  assert.equal(overrideRun.status, 0, overrideRun.stderr);
  const override = JSON.parse(overrideRun.stdout);
  assert.equal(override.keep, 3);
  assert.equal(override.keepSource, 'option');

  const orphanDir = path.join(sandbox.repo, 'state', 'backups', 'orphan-tool', '20260101-000000-000');
  fs.mkdirSync(orphanDir, { recursive: true });
  const orphanPreview = JSON.parse(
    runSandboxCli(sandbox, ['backup', 'prune', '--keep', '1', '--json']).stdout
  );
  const orphan = orphanPreview.items.find((item) => item.tool === 'orphan-tool');
  assert.equal(orphan.status, 'skipped');
  assert.match(orphan.reason, /未注册/);
  assert.equal(fs.existsSync(orphanDir), true);
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

test('backup 写操作遵守部署锁', machineSkip, (t) => {
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

  const createBlocked = runSandboxCli(sandbox, ['backup', 'create', '--json']);
  assert.equal(createBlocked.status, 1);
  assert.match(JSON.parse(createBlocked.stdout).error, /部署锁/);

  const prunePreview = runSandboxCli(sandbox, ['backup', 'prune', '--json']);
  assert.equal(prunePreview.status, 0, prunePreview.stderr);

  const pruneBlocked = runSandboxCli(sandbox, [
    'backup',
    'prune',
    '--apply',
    '--keep',
    '1',
    '--json'
  ]);
  assert.equal(pruneBlocked.status, 1);
  assert.match(JSON.parse(pruneBlocked.stdout).error, /部署锁/);
});

test('backup 参数错误时给出明确提示', machineSkip, (t) => {
  const sandbox = makeSandbox(t);

  const unknownTool = runSandboxCli(sandbox, ['backup', 'list', '--tool', 'nope', '--json']);
  assert.equal(unknownTool.status, 1);
  assert.match(JSON.parse(unknownTool.stdout).error, /未知目标/);

  const unknownCreate = runSandboxCli(sandbox, ['backup', 'create', '--tool', 'nope', '--json']);
  assert.equal(unknownCreate.status, 1);
  assert.match(JSON.parse(unknownCreate.stdout).error, /未知目标/);

  const unknownPrune = runSandboxCli(sandbox, ['backup', 'prune', '--tool', 'nope', '--json']);
  assert.equal(unknownPrune.status, 1);
  assert.match(JSON.parse(unknownPrune.stdout).error, /未知目标/);

  for (const keep of ['0', 'abc', '-1']) {
    const badKeep = runSandboxCli(sandbox, ['backup', 'prune', `--keep=${keep}`, '--json']);
    assert.equal(badKeep.status, 1);
    assert.match(JSON.parse(badKeep.stdout).error, /--keep/);
  }

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

test('content 列表、读取、预演、保存与新建会写回并重建构建', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const rulePath = path.join(sandbox.repo, 'content', 'rules', '01-communication.md');

  const list = runSandboxCli(sandbox, ['content', 'list', '--json']);
  assert.equal(list.status, 0, list.stderr);
  const listed = JSON.parse(list.stdout);
  assert.equal(listed.rules.some((rule) => rule.name === '00-index' && rule.isIndex), true);
  assert.equal(listed.skills.some((skill) => skill.name === 'aiwb' && skill.builtin), true);

  const read = runSandboxCli(sandbox, ['content', 'read', 'rule', '01-communication', '--json']);
  assert.equal(read.status, 0, read.stderr);
  const current = JSON.parse(read.stdout);
  assert.equal(current.file, 'content/rules/01-communication.md');
  assert.match(current.fileHash, /^sha256:[0-9a-f]{64}$/);

  const before = fs.readFileSync(rulePath, 'utf8');
  const next = `${before.trimEnd()}\n\n- CLI 保存测试新增。\n`;
  const contentFile = path.join(sandbox.repo, '_tmp-save.md');
  fs.writeFileSync(contentFile, next, 'utf8');

  const preview = runSandboxCli(sandbox, [
    'content',
    'save',
    'rule',
    '01-communication',
    '--content-file',
    contentFile,
    '--expected-hash',
    current.fileHash,
    '--json'
  ]);
  assert.equal(preview.status, 0, preview.stderr);
  const previewed = JSON.parse(preview.stdout);
  assert.equal(previewed.status, 'preview');
  assert.equal(previewed.canApply, true);
  assert.equal(fs.readFileSync(rulePath, 'utf8'), before);

  const applied = runSandboxCli(sandbox, [
    'content',
    'save',
    'rule',
    '01-communication',
    '--content-file',
    contentFile,
    '--expected-hash',
    current.fileHash,
    '--apply',
    '--json'
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const saved = JSON.parse(applied.stdout);
  assert.equal(saved.status, 'applied');
  assert.equal(saved.build.rebuilt, true);
  assert.equal(saved.build.entry, 'dist/ENTRY.md');
  assert.equal(fs.readFileSync(rulePath, 'utf8'), next);

  const check = runSandboxCli(sandbox, ['build', '--check', '--json']);
  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout).current, true);

  const stale = runSandboxCli(sandbox, [
    'content',
    'save',
    'rule',
    '01-communication',
    '--content-file',
    contentFile,
    '--expected-hash',
    `sha256:${'0'.repeat(64)}`,
    '--apply',
    '--json'
  ]);
  assert.equal(stale.status, 2);
  assert.equal(JSON.parse(stale.stdout).status, 'blocked');
  assert.equal(fs.readFileSync(rulePath, 'utf8'), next);

  const created = runSandboxCli(sandbox, [
    'content',
    'new-rule',
    'cli-rule',
    '--title',
    'CLI 规则',
    '--build',
    '--json'
  ]);
  assert.equal(created.status, 0, created.stderr);
  const newRule = JSON.parse(created.stdout);
  assert.equal(newRule.dryRun, false);
  assert.equal(newRule.build.rebuilt, true);
  assert.match(newRule.file, /^content\/rules\/\d{2}-cli-rule\.md$/);
  assert.equal(fs.existsSync(path.join(sandbox.repo, newRule.file)), true);
  assert.equal(newRule.log.recorded, 1);
  assert.match(newRule.log.file, /^state\/logs\/deploy-\d{6}\.jsonl$/);

  const createdSkill = runSandboxCli(sandbox, [
    'content',
    'new-skill',
    'cli-skill',
    '--description',
    '当 CLI 测试需要创建技能时使用',
    '--build',
    '--json'
  ]);
  assert.equal(createdSkill.status, 0, createdSkill.stderr);
  const newSkill = JSON.parse(createdSkill.stdout);
  assert.equal(newSkill.build.rebuilt, true);
  assert.equal(fs.existsSync(path.join(sandbox.repo, newSkill.file)), true);
  assert.equal(newSkill.log.recorded, 1);

  const dry = runSandboxCli(sandbox, ['content', 'new-rule', 'cli-dry', '--dry-run', '--json']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(fs.existsSync(path.join(sandbox.repo, JSON.parse(dry.stdout).file)), false);

  const lint = runSandboxCli(sandbox, ['content', 'lint', '--json']);
  assert.equal(lint.status, 0, lint.stderr);
  assert.equal(JSON.parse(lint.stdout).ok, true);
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

test('scan 与 attach 新建项目入口，detach 删除工作台创建的文件', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const built = runSandboxCli(sandbox, ['build', '--json']);
  assert.equal(built.status, 0, built.stderr);

  const projectPath = initProject(sandbox, 'alpha');
  const entryPath = path.join(projectPath, 'AGENTS.md');
  const excludePath = path.join(projectPath, '.git', 'info', 'exclude');

  const scan = runSandboxCli(sandbox, ['scan', '--root', sandbox.projectsRoot, '--json']);
  assert.equal(scan.status, 0, scan.stderr);
  const scanned = JSON.parse(scan.stdout);
  assert.equal(scanned.source, 'option');
  assert.equal(scanned.buildExists, true);
  assert.equal(scanned.projects.length, 1);
  assert.equal(scanned.projects[0].status, 'not-mounted');
  assert.equal(scanned.projects[0].tracked, false);
  assert.equal(scanned.projects[0].isRepo, true);
  assert.equal(scanned.projects[0].mode, 'auto');
  assert.equal(scanned.projects[0].excludePresent, false);
  assert.equal(scanned.summary.notMounted, 1);

  const preview = runSandboxCli(sandbox, ['attach', projectPath, '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const planned = JSON.parse(preview.stdout);
  assert.equal(planned.dryRun, true);
  assert.equal(planned.project.action, 'create-file');
  assert.equal(planned.project.status, 'ready');
  assert.equal(planned.project.canApply, true);
  assert.equal(planned.project.exclude.action, 'add');
  assert.equal(planned.summary.created, 1);
  assert.equal(fs.existsSync(entryPath), false);

  const applied = runSandboxCli(sandbox, ['attach', projectPath, '--apply', '--json']);
  assert.equal(applied.status, 0, applied.stderr);
  const attached = JSON.parse(applied.stdout);
  assert.equal(attached.apply.ok, true);
  assert.equal(attached.apply.action, 'create-file');
  assert.equal(attached.project.applyStatus, 'created');
  assert.equal(fs.existsSync(entryPath), true);
  assert.equal(findBlock(fs.readFileSync(entryPath, 'utf8')).blockHash, attached.project.blockHash);
  assert.match(fs.readFileSync(excludePath, 'utf8'), /^\/AGENTS\.md$/m);

  const state = JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8'));
  assert.deepEqual(Object.keys(state.projects), [projectPath]);
  assert.equal(state.projects[projectPath].mode, 'auto');
  assert.equal(state.projects[projectPath].file, 'AGENTS.md');
  assert.equal(state.projects[projectPath].action, 'create-file');
  assert.equal(state.projects[projectPath].excludeAdded, true);

  const mounted = JSON.parse(
    runSandboxCli(sandbox, ['scan', '--root', sandbox.projectsRoot, '--json']).stdout
  );
  assert.equal(mounted.projects[0].status, 'mounted');
  assert.equal(mounted.projects[0].excludePresent, true);
  assert.equal(mounted.summary.mounted, 1);

  const again = JSON.parse(runSandboxCli(sandbox, ['attach', projectPath, '--json']).stdout);
  assert.equal(again.project.action, 'unchanged');
  assert.equal(again.summary.unchanged, 1);
  const reapplied = runSandboxCli(sandbox, ['attach', projectPath, '--apply', '--json']);
  assert.equal(reapplied.status, 0, reapplied.stderr);
  assert.equal(JSON.parse(reapplied.stdout).apply.changed, false);

  const doctor = JSON.parse(runSandboxCli(sandbox, ['doctor', '--json']).stdout);
  assert.equal(doctor.checks.find((check) => check.id === 'projects').status, 'pass');

  const detachPreview = runSandboxCli(sandbox, ['detach', projectPath, '--json']);
  assert.equal(detachPreview.status, 0, detachPreview.stderr);
  const plannedDetach = JSON.parse(detachPreview.stdout);
  assert.equal(plannedDetach.project.status, 'delete-file');
  assert.equal(plannedDetach.project.canApply, true);
  assert.equal(plannedDetach.summary.deleted, 1);

  const detached = runSandboxCli(sandbox, ['detach', projectPath, '--apply', '--json']);
  assert.equal(detached.status, 0, detached.stderr);
  assert.equal(JSON.parse(detached.stdout).apply.action, 'delete-file');
  assert.equal(fs.existsSync(entryPath), false);
  assert.doesNotMatch(fs.readFileSync(excludePath, 'utf8'), /^\/AGENTS\.md$/m);
  const after = JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8'));
  assert.deepEqual(after.projects, {});
});

test('attach 不把已存在的 exclude 行记为工具添加，detach 保留该行', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  assert.equal(runSandboxCli(sandbox, ['build', '--json']).status, 0);

  const projectPath = initProject(sandbox, 'charlie');
  const excludePath = path.join(projectPath, '.git', 'info', 'exclude');
  fs.appendFileSync(excludePath, '/AGENTS.md\n', 'utf8');

  const preview = JSON.parse(
    runSandboxCli(sandbox, ['attach', projectPath, '--json']).stdout
  );
  assert.equal(preview.project.exclude.action, 'unchanged');

  const applied = runSandboxCli(sandbox, ['attach', projectPath, '--apply', '--json']);
  assert.equal(applied.status, 0, applied.stderr);
  const state = JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8'));
  assert.equal(state.projects[projectPath].excludeAdded, false);

  const detached = runSandboxCli(sandbox, ['detach', projectPath, '--apply', '--json']);
  assert.equal(detached.status, 0, detached.stderr);
  assert.match(fs.readFileSync(excludePath, 'utf8'), /^\/AGENTS\.md$/m);
});

test('attach 默认拒绝已跟踪入口，local 与 append 可显式写入', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  assert.equal(runSandboxCli(sandbox, ['build', '--json']).status, 0);

  const projectPath = initProject(sandbox, 'bravo');
  const entryPath = path.join(projectPath, 'AGENTS.md');
  const localPath = path.join(projectPath, 'AGENTS.local.md');
  const userText = '# 项目规则\n';
  fs.writeFileSync(entryPath, userText, 'utf8');
  const add = spawnSync('git', ['-C', projectPath, 'add', 'AGENTS.md'], { encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);

  const blocked = runSandboxCli(sandbox, ['attach', projectPath, '--json']);
  assert.equal(blocked.status, 2);
  const blockedData = JSON.parse(blocked.stdout);
  assert.equal(blockedData.project.status, 'blocked');
  assert.match(blockedData.project.reason, /已被 git 跟踪/);

  const blockedApply = runSandboxCli(sandbox, ['attach', projectPath, '--apply', '--json']);
  assert.equal(blockedApply.status, 2);
  assert.equal(JSON.parse(blockedApply.stdout).apply.blocked, 1);
  assert.equal(fs.readFileSync(entryPath, 'utf8'), userText);

  const local = JSON.parse(
    runSandboxCli(sandbox, ['attach', projectPath, '--mode', 'local', '--json']).stdout
  );
  assert.equal(local.project.file, 'AGENTS.local.md');
  assert.equal(local.project.action, 'create-file');
  assert.equal(local.project.canApply, true);
  const localApplied = runSandboxCli(sandbox, [
    'attach',
    projectPath,
    '--mode',
    'local',
    '--apply',
    '--json'
  ]);
  assert.equal(localApplied.status, 0, localApplied.stderr);
  assert.equal(fs.existsSync(localPath), true);
  assert.match(
    fs.readFileSync(path.join(projectPath, '.git', 'info', 'exclude'), 'utf8'),
    /^\/AGENTS\.local\.md$/m
  );

  const localDetach = runSandboxCli(sandbox, ['detach', projectPath, '--apply', '--json']);
  assert.equal(localDetach.status, 0, localDetach.stderr);
  assert.equal(fs.existsSync(localPath), false);

  const appendPreview = JSON.parse(
    runSandboxCli(sandbox, ['attach', projectPath, '--mode', 'append', '--json']).stdout
  );
  assert.equal(appendPreview.project.action, 'append-block');
  assert.equal(appendPreview.project.tracked, true);
  assert.equal(appendPreview.project.canApply, true);
  assert.equal(appendPreview.project.exclude.action, 'skip');

  const appended = runSandboxCli(sandbox, [
    'attach',
    projectPath,
    '--mode',
    'append',
    '--apply',
    '--json'
  ]);
  assert.equal(appended.status, 0, appended.stderr);
  const appendedText = fs.readFileSync(entryPath, 'utf8');
  assert.match(appendedText, /^# 项目规则/);
  assert.equal(findBlock(appendedText).status, 'present');

  const removed = runSandboxCli(sandbox, ['detach', projectPath, '--apply', '--json']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(JSON.parse(removed.stdout).apply.action, 'remove-block');
  assert.equal(fs.readFileSync(entryPath, 'utf8'), userText);
});

test('local 目标入口自身被跟踪时阻止，并只建议 append', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  assert.equal(runSandboxCli(sandbox, ['build', '--json']).status, 0);

  const projectPath = initProject(sandbox, 'golf');
  const localPath = path.join(projectPath, 'AGENTS.local.md');
  const userText = '# 本地规则\n';
  fs.writeFileSync(localPath, userText, 'utf8');
  const add = spawnSync('git', ['-C', projectPath, 'add', '-f', 'AGENTS.local.md'], {
    encoding: 'utf8'
  });
  assert.equal(add.status, 0, add.stderr);

  const blocked = runSandboxCli(sandbox, ['attach', projectPath, '--mode', 'local', '--json']);
  assert.equal(blocked.status, 2);
  const data = JSON.parse(blocked.stdout);
  assert.equal(data.project.status, 'blocked');
  assert.equal(data.project.file, 'AGENTS.local.md');
  assert.match(data.project.reason, /已被 git 跟踪/);
  assert.match(data.project.reason, /--mode append/);
  assert.doesNotMatch(data.project.reason, /--mode local/);
  assert.equal(fs.readFileSync(localPath, 'utf8'), userText);
});

test('已挂载项目切换入口文件时阻止，取消挂载后可重新挂载', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  assert.equal(runSandboxCli(sandbox, ['build', '--json']).status, 0);

  const projectPath = initProject(sandbox, 'hotel');
  const entryPath = path.join(projectPath, 'AGENTS.md');
  const localPath = path.join(projectPath, 'AGENTS.local.md');
  const attached = runSandboxCli(sandbox, ['attach', projectPath, '--apply', '--json']);
  assert.equal(attached.status, 0, attached.stderr);
  assert.equal(fs.existsSync(entryPath), true);

  const blocked = runSandboxCli(sandbox, ['attach', projectPath, '--mode', 'local', '--json']);
  assert.equal(blocked.status, 2);
  const data = JSON.parse(blocked.stdout);
  assert.equal(data.project.status, 'blocked');
  assert.equal(data.project.file, 'AGENTS.local.md');
  assert.match(data.project.reason, /先取消挂载/);
  assert.equal(fs.existsSync(localPath), false);

  const detached = runSandboxCli(sandbox, ['detach', projectPath, '--apply', '--json']);
  assert.equal(detached.status, 0, detached.stderr);
  assert.equal(fs.existsSync(entryPath), false);

  const localPreview = JSON.parse(
    runSandboxCli(sandbox, ['attach', projectPath, '--mode', 'local', '--json']).stdout
  );
  assert.equal(localPreview.project.status, 'ready');
  assert.equal(localPreview.project.canApply, true);
  assert.equal(localPreview.project.file, 'AGENTS.local.md');
});

test('detach 没有记录时默认阻止，--force 只移除块', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  assert.equal(runSandboxCli(sandbox, ['build', '--json']).status, 0);

  const projectPath = initProject(sandbox, 'charlie');
  const entryPath = path.join(projectPath, 'AGENTS.md');
  const userText = '# 项目规则\n';
  fs.writeFileSync(entryPath, `${userText}\n${wrapBlock('> 指针')}\n`, 'utf8');

  const preview = runSandboxCli(sandbox, ['detach', projectPath, '--json']);
  assert.equal(preview.status, 2);
  const planned = JSON.parse(preview.stdout);
  assert.equal(planned.project.status, 'blocked');
  assert.equal(planned.project.canForce, true);
  assert.match(planned.project.reason, /--force/);

  const forced = runSandboxCli(sandbox, ['detach', projectPath, '--force', '--json']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(JSON.parse(forced.stdout).project.status, 'remove-block');

  const applied = runSandboxCli(sandbox, [
    'detach',
    projectPath,
    '--force',
    '--apply',
    '--json'
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).apply.action, 'remove-block');
  assert.equal(fs.existsSync(entryPath), true);
  const remaining = fs.readFileSync(entryPath, 'utf8');
  assert.equal(remaining.trim(), '# 项目规则');
  assert.equal(findBlock(remaining).status, 'absent');
  assert.equal(fs.existsSync(sandbox.statePath), false);
});

test('scan 报告块漂移，doctor 失败，detach 默认阻止手改块', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  assert.equal(runSandboxCli(sandbox, ['build', '--json']).status, 0);

  const projectPath = initProject(sandbox, 'echo');
  const entryPath = path.join(projectPath, 'AGENTS.md');
  assert.equal(
    runSandboxCli(sandbox, ['attach', projectPath, '--apply', '--json']).status,
    0
  );

  const text = fs.readFileSync(entryPath, 'utf8');
  const found = findBlock(text);
  fs.writeFileSync(
    entryPath,
    `${text.replace(found.inner, `${found.inner}\n> 手改`)}\n# 项目自有规则\n`,
    'utf8'
  );

  const scan = JSON.parse(
    runSandboxCli(sandbox, ['scan', '--root', sandbox.projectsRoot, '--json']).stdout
  );
  assert.equal(scan.projects[0].status, 'drift');
  assert.equal(scan.summary.drift, 1);

  const doctor = JSON.parse(runSandboxCli(sandbox, ['doctor', '--json']).stdout);
  const projectCheck = doctor.checks.find((check) => check.id === 'projects');
  assert.equal(projectCheck.status, 'fail');
  assert.match(projectCheck.detail, /块被手改/);

  const preview = runSandboxCli(sandbox, ['detach', projectPath, '--json']);
  assert.equal(preview.status, 2);
  const planned = JSON.parse(preview.stdout);
  assert.equal(planned.project.canForce, true);
  assert.match(planned.project.reason, /不一致/);

  const blocked = runSandboxCli(sandbox, ['detach', projectPath, '--apply', '--json']);
  assert.equal(blocked.status, 2);
  assert.equal(findBlock(fs.readFileSync(entryPath, 'utf8')).status, 'present');

  const forced = runSandboxCli(sandbox, [
    'detach',
    projectPath,
    '--force',
    '--apply',
    '--json'
  ]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(JSON.parse(forced.stdout).apply.action, 'remove-block');
  assert.equal(fs.existsSync(entryPath), true);
  const remaining = fs.readFileSync(entryPath, 'utf8');
  assert.match(remaining, /项目自有规则/);
  assert.equal(findBlock(remaining).status, 'absent');
});

test('attach 受部署锁保护，已占用时不写入', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  assert.equal(runSandboxCli(sandbox, ['build', '--json']).status, 0);

  const projectPath = initProject(sandbox, 'delta');
  const entryPath = path.join(projectPath, 'AGENTS.md');
  fs.mkdirSync(path.join(sandbox.repo, 'state', 'locks'), { recursive: true });
  fs.writeFileSync(
    path.join(sandbox.repo, 'state', 'locks', 'deploy.lock'),
    `${JSON.stringify({
      token: 'other-token',
      pid: 999999,
      host: os.hostname(),
      acquiredAt: new Date().toISOString()
    })}\n`,
    'utf8'
  );

  const blocked = runSandboxCli(sandbox, ['attach', projectPath, '--apply', '--json']);
  assert.equal(blocked.status, 1);
  assert.match(JSON.parse(blocked.stdout).error, /部署锁已被占用/);
  assert.equal(fs.existsSync(entryPath), false);
});

test('merge 写入保留块外原文并记录手工合并', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const existing = '# 用户规则\n\n- 保留我\n';
  fs.writeFileSync(sandbox.entryPath, existing, 'utf8');

  const deploy = runSandboxCli(sandbox, [
    'deploy',
    '--apply',
    '--tool',
    'qoder-cn',
    '--json'
  ]);
  assert.equal(deploy.status, 0, deploy.stderr);
  const deployedText = fs.readFileSync(sandbox.entryPath, 'utf8');
  const handEdited = replaceBlock(deployedText, wrapBlock('被手工修改的旧入口'));
  fs.writeFileSync(sandbox.entryPath, handEdited, 'utf8');

  const preview = runSandboxCli(sandbox, ['merge', 'qoder-cn', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.canApply, true);
  assert.equal(plan.entry.blockStatus, 'present');
  assert.equal(plan.entry.modifiedSinceDeploy, true);
  assert.ok(plan.suggested.startsWith(existing));
  assert.ok(plan.suggested.includes('被手工修改的旧入口') === false);
  assert.equal(
    findBlock(plan.suggested).blockHash,
    plan.workbench.blockHash
  );

  const content = replaceBlock(handEdited, wrapBlock('人工合并后的正文'));
  const contentFile = path.join(sandbox.repo, 'merge-content.md');
  fs.writeFileSync(contentFile, content, 'utf8');

  const applied = runSandboxCli(sandbox, [
    'merge',
    'qoder-cn',
    '--apply',
    '--content-file',
    contentFile,
    '--json'
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.status, 'written');
  assert.equal(result.applied, true);
  assert.ok(result.backup);
  assert.equal(result.entry.modifiedSinceDeploy, false);
  assert.equal(result.entry.storedBlockHash, result.merged.blockHash);
  assert.equal(result.warnings.length, 0);

  const written = fs.readFileSync(sandbox.entryPath, 'utf8');
  const beforePrefix = handEdited.slice(0, findBlock(handEdited).beginIndex);
  const afterPrefix = written.slice(0, findBlock(written).beginIndex);
  assert.equal(afterPrefix, beforePrefix);
  assert.equal(findBlock(written).inner, '人工合并后的正文');

  const backupRoot = path.join(sandbox.repo, 'state', 'backups', 'qoder-cn');
  assert.ok(fs.readdirSync(backupRoot).length >= 2);

  const state = JSON.parse(fs.readFileSync(sandbox.statePath, 'utf8'));
  assert.equal(state.targets['qoder-cn'].action, 'manual-merge');
  assert.equal(state.targets['qoder-cn'].manualMerge, true);
  assert.equal(state.targets['qoder-cn'].blockHash, findBlock(written).blockHash);

  const status = runSandboxCli(sandbox, ['status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  const qoder = JSON.parse(status.stdout).targets.find((target) => target.id === 'qoder-cn');
  assert.equal(qoder.state, 'ok');

  const redeploy = runSandboxCli(sandbox, [
    'deploy',
    '--apply',
    '--tool',
    'qoder-cn',
    '--json'
  ]);
  assert.equal(redeploy.status, 0, redeploy.stderr);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), written);
});

test('merge 拒绝块外改动且不写文件', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const existing = '# 用户规则\n\n- 保留我\n';
  fs.writeFileSync(sandbox.entryPath, existing, 'utf8');
  assert.equal(
    runSandboxCli(sandbox, ['deploy', '--apply', '--tool', 'qoder-cn', '--json']).status,
    0
  );
  const deployedText = fs.readFileSync(sandbox.entryPath, 'utf8');

  const preview = runSandboxCli(sandbox, ['merge', 'qoder-cn', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  const edited = plan.suggested.replace('- 保留我', '- 保留我（改）');
  const contentFile = path.join(sandbox.repo, 'merge-outside.md');
  fs.writeFileSync(contentFile, edited, 'utf8');

  const applied = runSandboxCli(sandbox, [
    'merge',
    'qoder-cn',
    '--apply',
    '--content-file',
    contentFile,
    '--json'
  ]);
  assert.equal(applied.status, 2);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.status, 'blocked');
  assert.equal(result.issues.some((issue) => issue.code === 'prefix-changed'), true);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), deployedText);

  const missingContent = runSandboxCli(sandbox, [
    'merge',
    'qoder-cn',
    '--apply',
    '--json'
  ]);
  assert.equal(missingContent.status, 1);
  assert.match(JSON.parse(missingContent.stdout).error, /--content-file/);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), deployedText);
});

test('merge 遇到损坏的块标记时阻止写入', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const broken = `# 用户规则\n<!-- AI-WORKBENCH:BEGIN -->\n没有结束标记\n`;
  fs.writeFileSync(sandbox.entryPath, broken, 'utf8');

  const preview = runSandboxCli(sandbox, ['merge', 'qoder-cn', '--json']);
  assert.equal(preview.status, 2);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.canApply, false);
  assert.equal(plan.suggested, null);
  assert.equal(plan.issues.some((issue) => issue.code === 'current-malformed'), true);
  assert.equal(fs.readFileSync(sandbox.entryPath, 'utf8'), broken);

  const unknown = runSandboxCli(sandbox, ['merge', 'not-a-tool', '--json']);
  assert.equal(unknown.status, 1);
  assert.match(JSON.parse(unknown.stdout).error, /未知目标/);
});

test('merge 为独立文件新建 frontmatter 与工作台块', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  fs.mkdirSync(path.join(sandbox.home, '.codebuddy'), { recursive: true });

  const preview = runSandboxCli(sandbox, ['merge', 'codebuddy', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.canApply, true);
  assert.match(plan.suggested, /^---\n/);

  const contentFile = path.join(sandbox.repo, 'merge-mdc.md');
  fs.writeFileSync(contentFile, plan.suggested, 'utf8');
  const applied = runSandboxCli(sandbox, [
    'merge',
    'codebuddy',
    '--apply',
    '--content-file',
    contentFile,
    '--json'
  ]);
  assert.equal(applied.status, 0, applied.stderr);

  const entryPath = path.join(
    sandbox.home,
    '.codebuddy',
    'rules',
    '00-ai-workbench.mdc'
  );
  const written = fs.readFileSync(entryPath, 'utf8');
  assert.match(written, /^---\n/);
  assert.equal(findBlock(written).status, 'present');
  assert.equal(fs.readFileSync(entryPath, 'utf8'), plan.suggested);
});

test('settings show/set/unset 安全写回机器档案并保留正文', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const machinePath = path.join(sandbox.repo, 'machines', `${os.hostname()}.md`);
  const original = fs.readFileSync(machinePath, 'utf8');

  const show = runSandboxCli(sandbox, ['settings', 'show', '--json']);
  assert.equal(show.status, 0, show.stderr);
  const shown = JSON.parse(show.stdout);
  assert.equal(shown.ok, true);
  assert.equal(shown.hasSection, false);
  assert.equal(shown.writable, true);
  assert.deepEqual(shown.env, {});
  assert.deepEqual(shown.overrides, {});
  assert.equal(shown.tools.find((tool) => tool.id === 'qoder-cn').overrides.entryPath, null);

  const setArgs = [
    'settings',
    'set',
    'backupRetention=3',
    `env.AIWB_SETTINGS_ROOT=${sandbox.projectsRoot}`,
    'tools.qoder-cn.entryPath=${AIWB_SETTINGS_ROOT}\\agents\\AGENTS.md'
  ];
  const preview = runSandboxCli(sandbox, [...setArgs, '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const planned = JSON.parse(preview.stdout);
  assert.equal(planned.dryRun, true);
  assert.equal(planned.status, 'preview');
  assert.equal(planned.changed, true);
  assert.equal(planned.ok, true);
  assert.deepEqual(
    planned.changes.map((change) => [change.key, change.action]),
    [
      ['backupRetention', 'update'],
      ['env.AIWB_SETTINGS_ROOT', 'set'],
      ['tools.qoder-cn.entryPath', 'set']
    ]
  );
  assert.equal(fs.readFileSync(machinePath, 'utf8'), original);

  const applied = runSandboxCli(sandbox, [
    ...setArgs,
    '--apply',
    '--expected-hash',
    planned.fileHash,
    '--json'
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.status, 'applied');
  assert.equal(result.dryRun, false);
  assert.equal(result.ok, true);
  assert.match(result.backup, /^state\/settings-backups\//);

  const backupDir = path.join(sandbox.repo, result.backup);
  const backupFile = path.join(backupDir, `${os.hostname()}.md`);
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  assert.equal(fs.readFileSync(backupFile, 'utf8'), original);
  assert.equal(manifest.action, 'settings-update');
  assert.equal(manifest.originalHash, planned.fileHash);
  assert.deepEqual(
    manifest.changes.map((change) => [change.key, change.action]),
    [
      ['backupRetention', 'update'],
      ['env.AIWB_SETTINGS_ROOT', 'set'],
      ['tools.qoder-cn.entryPath', 'set']
    ]
  );

  const written = fs.readFileSync(machinePath, 'utf8');
  const parsed = parseSettingsText(written);
  assert.equal(parsed.backupRetention.value, 3);
  assert.equal(parsed.settings.env.AIWB_SETTINGS_ROOT, sandbox.projectsRoot);
  assert.equal(
    parsed.settings.tools['qoder-cn'].entryPath,
    '${AIWB_SETTINGS_ROOT}\\agents\\AGENTS.md'
  );
  assert.equal(written.includes('## 设置'), true);
  assert.equal(written.includes('## 路径'), true);
  assert.equal(written.includes(original.split('\n')[0]), true);

  const shownAgain = JSON.parse(
    runSandboxCli(sandbox, ['settings', 'show', '--json']).stdout
  );
  assert.equal(shownAgain.ok, true);
  assert.equal(shownAgain.backupRetention.value, 3);
  assert.equal(shownAgain.env.AIWB_SETTINGS_ROOT, sandbox.projectsRoot);
  assert.equal(
    shownAgain.tools.find((tool) => tool.id === 'qoder-cn').entryPath,
    path.join(sandbox.projectsRoot, 'agents', 'AGENTS.md')
  );

  const unset = runSandboxCli(sandbox, [
    'settings',
    'unset',
    'env.AIWB_SETTINGS_ROOT',
    'tools.qoder-cn.entryPath',
    '--apply',
    '--json'
  ]);
  assert.equal(unset.status, 0, unset.stderr);
  const unsetResult = JSON.parse(unset.stdout);
  assert.equal(unsetResult.status, 'applied');
  assert.deepEqual(
    unsetResult.changes.map((change) => [change.key, change.action]),
    [
      ['env.AIWB_SETTINGS_ROOT', 'unset'],
      ['tools.qoder-cn.entryPath', 'unset']
    ]
  );
  assert.deepEqual(
    fs.readdirSync(path.join(sandbox.repo, 'state', 'settings-backups')).length,
    2
  );

  const final = JSON.parse(runSandboxCli(sandbox, ['settings', 'show', '--json']).stdout);
  assert.deepEqual(final.env, {});
  assert.deepEqual(final.overrides, {});
  assert.equal(final.backupRetention.value, 3);
});

test('自定义工具可通过设置注册并单独部署', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const configRoot = path.join(sandbox.home, 'my-tool');
  const entryPath = path.join(configRoot, 'AGENTS.md');
  const skillsDir = path.join(configRoot, 'skills');

  const setArgs = [
    'settings',
    'set',
    'customTools.my-tool.name=My Tool',
    `customTools.my-tool.configRoot=${configRoot}`,
    `customTools.my-tool.entryPath=${entryPath}`,
    'customTools.my-tool.strategy=block-append',
    'customTools.my-tool.format=markdown',
    `customTools.my-tool.skillsDir=${skillsDir}`
  ];
  const preview = runSandboxCli(sandbox, [...setArgs, '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const planned = JSON.parse(preview.stdout);
  assert.equal(planned.status, 'preview');
  assert.equal(planned.ok, true);
  assert.equal(
    planned.changes.every((change) => change.key.startsWith('customTools.my-tool.')),
    true
  );
  assert.equal(fs.existsSync(entryPath), false);

  const applied = runSandboxCli(sandbox, [
    ...setArgs,
    '--apply',
    '--expected-hash',
    planned.fileHash,
    '--json'
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const registered = JSON.parse(applied.stdout);
  assert.equal(registered.status, 'applied');
  assert.equal(registered.ok, true);
  assert.equal(registered.customTools['my-tool'].entryPath, entryPath);

  const detect = JSON.parse(runSandboxCli(sandbox, ['detect', '--json']).stdout);
  const detected = detect.tools.find((tool) => tool.id === 'my-tool');
  assert.ok(detected);
  assert.equal(detected.custom, true);
  assert.equal(detected.installed, false);
  assert.equal(detected.configRootExists, false);
  assert.equal(detected.entryPath, entryPath);
  assert.equal(detect.settings.customTools.includes('my-tool'), true);

  const deployPreview = JSON.parse(
    runSandboxCli(sandbox, ['deploy', '--tool', 'my-tool', '--dry-run', '--json']).stdout
  );
  assert.equal(deployPreview.targets.length, 1);
  assert.equal(deployPreview.targets[0].id, 'my-tool');
  assert.equal(deployPreview.targets[0].custom, true);
  assert.equal(deployPreview.targets[0].action, 'create-file');
  assert.equal(deployPreview.targets[0].installed, false);
  assert.equal(fs.existsSync(entryPath), false);

  const deploy = JSON.parse(
    runSandboxCli(sandbox, ['deploy', '--tool', 'my-tool', '--apply', '--json']).stdout
  );
  assert.equal(deploy.apply.ok, true);
  assert.equal(deploy.targets[0].applyStatus, 'written');
  assert.equal(fs.existsSync(entryPath), true);
  assert.equal(findBlock(fs.readFileSync(entryPath, 'utf8')).status, 'present');
  assert.equal(fs.lstatSync(path.join(skillsDir, 'aiwb')).isSymbolicLink(), true);

  const status = JSON.parse(runSandboxCli(sandbox, ['status', '--json']).stdout);
  const customStatus = status.targets.find((target) => target.id === 'my-tool');
  assert.equal(customStatus.state, 'ok');
  assert.equal(customStatus.label, '正常');
});

test('版本要求阻止不符的工具部署、合并与恢复，匹配后放行', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const configRoot = path.join(sandbox.home, 'version-tool');
  const entryPath = path.join(configRoot, 'AGENTS.md');
  const skillsDir = path.join(configRoot, 'skills');
  const statusFile = path.join(configRoot, '.status.json');
  fs.mkdirSync(configRoot, { recursive: true });
  fs.writeFileSync(statusFile, JSON.stringify({ appVersion: '2.0.0' }), 'utf8');

  const setArgs = [
    'settings',
    'set',
    'customTools.my-tool.name=Version Tool',
    `customTools.my-tool.configRoot=${configRoot}`,
    `customTools.my-tool.entryPath=${entryPath}`,
    'customTools.my-tool.version=>=1.0,(<1.5 || >=3.0)',
    `customTools.my-tool.skillsDir=${skillsDir}`
  ];
  const planned = JSON.parse(runSandboxCli(sandbox, [...setArgs, '--json']).stdout);
  assert.equal(planned.ok, true);
  const registered = runSandboxCli(sandbox, [
    ...setArgs,
    '--apply',
    '--expected-hash',
    planned.fileHash,
    '--json'
  ]);
  assert.equal(registered.status, 0, registered.stderr);
  assert.equal(
    JSON.parse(registered.stdout).customTools['my-tool'].version,
    '>=1.0,(<1.5 || >=3.0)'
  );

  const blockedPreviewRun = runSandboxCli(sandbox, [
    'deploy',
    '--tool',
    'my-tool',
    '--dry-run',
    '--json'
  ]);
  assert.equal(blockedPreviewRun.status, 2, blockedPreviewRun.stderr);
  const blockedPreview = JSON.parse(blockedPreviewRun.stdout);
  assert.equal(blockedPreview.summary.versionBlocked, 1);
  assert.equal(blockedPreview.targets[0].action, 'version-blocked');
  assert.match(blockedPreview.targets[0].reason, /版本不符/);
  assert.equal(blockedPreview.skills.tools[0].action, 'skip-version-blocked');
  assert.equal(fs.existsSync(entryPath), false);
  assert.equal(fs.existsSync(skillsDir), false);

  const blockedApply = runSandboxCli(sandbox, [
    'deploy',
    '--tool',
    'my-tool',
    '--apply',
    '--json'
  ]);
  assert.equal(blockedApply.status, 2, blockedApply.stderr);
  const blockedApplied = JSON.parse(blockedApply.stdout);
  assert.equal(blockedApplied.apply.ok, true);
  assert.equal(blockedApplied.apply.blocked, 1);
  assert.equal(blockedApplied.apply.written, 0);
  assert.equal(fs.existsSync(entryPath), false);

  const mergeRun = runSandboxCli(sandbox, ['merge', 'my-tool', '--json']);
  assert.equal(mergeRun.status, 2, mergeRun.stderr);
  const merge = JSON.parse(mergeRun.stdout);
  assert.equal(merge.status, 'blocked');
  assert.equal(
    merge.issues.some((issue) => issue.code === 'version-blocked'),
    true
  );

  const blockedStatus = JSON.parse(runSandboxCli(sandbox, ['status', '--json']).stdout);
  assert.equal(blockedStatus.summary.versionBlocked, 1);
  assert.equal(
    blockedStatus.targets.find((target) => target.id === 'my-tool').state,
    'version-blocked'
  );

  fs.writeFileSync(statusFile, JSON.stringify({ appVersion: '1.0.0' }), 'utf8');
  const deployed = runSandboxCli(sandbox, [
    'deploy',
    '--tool',
    'my-tool',
    '--apply',
    '--json'
  ]);
  assert.equal(deployed.status, 0, deployed.stderr);
  const deployedData = JSON.parse(deployed.stdout);
  assert.equal(deployedData.targets[0].applyStatus, 'written');
  assert.equal(fs.existsSync(entryPath), true);
  assert.equal(fs.lstatSync(path.join(skillsDir, 'aiwb')).isSymbolicLink(), true);

  const backupResult = JSON.parse(
    runSandboxCli(sandbox, ['backup', 'create', '--tool', 'my-tool', '--json']).stdout
  );
  assert.equal(backupResult.summary.created, 1);
  const stamp = path.basename(backupResult.tools[0].backup);
  fs.appendFileSync(entryPath, '\n<!-- 手工改动 -->\n', 'utf8');
  fs.writeFileSync(statusFile, JSON.stringify({ appVersion: '2.0.0' }), 'utf8');

  const restorePreviewRun = runSandboxCli(sandbox, [
    'backup',
    'restore',
    'my-tool',
    stamp,
    '--json'
  ]);
  assert.equal(restorePreviewRun.status, 2, restorePreviewRun.stderr);
  const restorePreview = JSON.parse(restorePreviewRun.stdout);
  assert.equal(restorePreview.status, 'blocked');
  assert.equal(restorePreview.canForce, true);
  assert.match(restorePreview.reason, /版本核对未通过/);

  const forced = runSandboxCli(sandbox, [
    'backup',
    'restore',
    'my-tool',
    stamp,
    '--apply',
    '--force',
    '--json'
  ]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(JSON.parse(forced.stdout).status, 'restored');
  assert.equal(fs.readFileSync(entryPath, 'utf8').includes('手工改动'), false);
});

test('settings apply 拒绝过期哈希且不写文件', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const machinePath = path.join(sandbox.repo, 'machines', `${os.hostname()}.md`);

  const preview = runSandboxCli(sandbox, ['settings', 'set', 'guiPort=5088', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const planned = JSON.parse(preview.stdout);
  assert.equal(planned.status, 'preview');
  const before = fs.readFileSync(machinePath, 'utf8');

  fs.appendFileSync(machinePath, '\n<!-- 设置预演后修改 -->\n', 'utf8');
  const changed = fs.readFileSync(machinePath, 'utf8');

  const stale = runSandboxCli(sandbox, [
    'settings',
    'set',
    'guiPort=5088',
    '--apply',
    '--expected-hash',
    planned.fileHash,
    '--json'
  ]);
  assert.equal(stale.status, 2, stale.stderr);
  const result = JSON.parse(stale.stdout);
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /预演后已变化/);
  assert.equal(fs.readFileSync(machinePath, 'utf8'), changed);
  assert.equal(fs.existsSync(path.join(sandbox.repo, 'state', 'settings-backups')), false);
  assert.notEqual(before, changed);
});

test('settings 阻止未定义环境变量并遵守部署锁', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const machinePath = path.join(sandbox.repo, 'machines', `${os.hostname()}.md`);
  const original = fs.readFileSync(machinePath, 'utf8');

  const badPath = runSandboxCli(sandbox, [
    'settings',
    'set',
    'tools.qoder-cn.skillsDir=${NOT_DEFINED}\\skills',
    '--json'
  ]);
  assert.equal(badPath.status, 2, badPath.stderr);
  const badPlan = JSON.parse(badPath.stdout);
  assert.equal(badPlan.status, 'preview');
  assert.equal(badPlan.ok, false);
  assert.equal(
    badPlan.issues.some((issue) => issue.key === 'tools.qoder-cn.skillsDir'),
    true
  );

  const blocked = runSandboxCli(sandbox, [
    'settings',
    'set',
    'tools.qoder-cn.skillsDir=${NOT_DEFINED}\\skills',
    '--apply',
    '--json'
  ]);
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).status, 'blocked');
  assert.equal(fs.readFileSync(machinePath, 'utf8'), original);

  const lockPath = path.join(sandbox.repo, 'state', 'locks', 'deploy.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(
    lockPath,
    `${JSON.stringify({ token: 'test', pid: 999999, host: os.hostname(), acquiredAt: new Date().toISOString() })}\n`,
    'utf8'
  );
  const locked = runSandboxCli(sandbox, [
    'settings',
    'set',
    'backupRetention=6',
    '--apply',
    '--json'
  ]);
  assert.equal(locked.status, 1, locked.stderr);
  assert.match(JSON.parse(locked.stdout).error, /部署锁/);
  assert.equal(fs.readFileSync(machinePath, 'utf8'), original);
});

test('log 记录部署、备份、内容与设置写入且不保存正文', machineSkip, (t) => {
  const sandbox = makeSandbox(t);

  const empty = runSandboxCli(sandbox, ['log', '--json']);
  assert.equal(empty.status, 0, empty.stderr);
  const emptyLog = JSON.parse(empty.stdout);
  assert.equal(emptyLog.subcommand, 'list');
  assert.equal(emptyLog.total, 0);
  assert.deepEqual(emptyLog.files, []);
  assert.deepEqual(emptyLog.deploy.targets, []);
  assert.deepEqual(emptyLog.deploy.projects, []);
  assert.equal(emptyLog.ok, true);

  const dry = runSandboxCli(sandbox, ['deploy', '--tool', 'qoder-cn', '--dry-run', '--json']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(
    JSON.parse(runSandboxCli(sandbox, ['log', '--json']).stdout).total,
    0,
    '预演不应写入操作日志'
  );

  const deployed = runSandboxCli(sandbox, ['deploy', '--tool', 'qoder-cn', '--apply', '--json']);
  assert.equal(deployed.status, 0, deployed.stderr);
  const deployedResult = JSON.parse(deployed.stdout);
  assert.ok(deployedResult.log.recorded >= 1);
  assert.match(deployedResult.log.file, /^state\/logs\/deploy-\d{6}\.jsonl$/);

  const backup = runSandboxCli(sandbox, ['backup', 'create', '--tool', 'qoder-cn', '--json']);
  assert.equal(backup.status, 0, backup.stderr);
  assert.equal(JSON.parse(backup.stdout).log.recorded, 1);

  const rule = path.join(sandbox.repo, 'content', 'rules', '01-communication.md');
  const read = runSandboxCli(sandbox, ['content', 'read', 'rule', '01-communication', '--json']);
  assert.equal(read.status, 0, read.stderr);
  const current = JSON.parse(read.stdout);
  const marker = '操作日志不应保存正文-LOG-BODY';
  const contentFile = path.join(sandbox.repo, '_tmp-log-save.md');
  fs.writeFileSync(contentFile, `${current.content.trimEnd()}\n\n- ${marker}\n`, 'utf8');
  const saved = runSandboxCli(sandbox, [
    'content',
    'save',
    'rule',
    '01-communication',
    '--content-file',
    contentFile,
    '--expected-hash',
    current.fileHash,
    '--apply',
    '--json'
  ]);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(JSON.parse(saved.stdout).log.recorded, 1);

  const settings = runSandboxCli(sandbox, ['settings', 'set', 'guiPort=5088', '--apply', '--json']);
  assert.equal(settings.status, 0, settings.stderr);
  assert.equal(JSON.parse(settings.stdout).log.recorded, 1);

  const listed = runSandboxCli(sandbox, ['log', '--json']);
  assert.equal(listed.status, 0, listed.stderr);
  const log = JSON.parse(listed.stdout);
  assert.ok(log.total >= 4);
  assert.equal(log.truncated, false);
  assert.equal(log.files.length, 1);
  assert.equal(log.files[0].entries, log.total);
  assert.equal(log.files[0].issues, 0);
  assert.deepEqual(
    log.entries.slice(0, 3).map((entry) => entry.action),
    ['settings-set', 'content-save', 'backup-create']
  );
  const deployActions = log.entries.slice(3).map((entry) => entry.action);
  assert.equal(deployActions.includes('deploy'), true);
  assert.equal(new Set(deployActions).size <= 2, true);
  assert.equal(log.entries.every((entry) => entry.source === 'cli'), true);

  const deployEntry = log.entries.find((entry) => entry.action === 'deploy');
  assert.equal(deployEntry.tool, 'qoder-cn');
  assert.equal(deployEntry.result, 'written');
  assert.match(deployEntry.target, /AGENTS\.md$/);
  assert.match(deployEntry.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);

  const contentEntry = log.entries.find((entry) => entry.action === 'content-save');
  assert.equal(contentEntry.target, 'content/rules/01-communication.md');
  assert.deepEqual(contentEntry.detail, {
    kind: 'rule',
    name: '01-communication',
    contentHash: JSON.parse(saved.stdout).build.contentHash
  });

  const settingsEntry = log.entries.find((entry) => entry.action === 'settings-set');
  assert.deepEqual(settingsEntry.detail, { keys: ['guiPort'] });

  assert.equal(log.deploy.targets.some((target) => target.tool === 'qoder-cn'), true);
  assert.ok(Array.isArray(log.deploy.projects));

  const limited = JSON.parse(
    runSandboxCli(sandbox, ['log', '--limit', '2', '--json']).stdout
  );
  assert.equal(limited.limit, 2);
  assert.equal(limited.truncated, true);
  assert.deepEqual(
    limited.entries.map((entry) => entry.action),
    ['settings-set', 'content-save']
  );

  const human = runSandboxCli(sandbox, ['log', '--limit', '5']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /操作历史/);
  assert.match(human.stdout, /部署记录/);
  assert.match(human.stdout, /设置/);

  const invalid = runSandboxCli(sandbox, ['log', '--limit', '0', '--json']);
  assert.equal(invalid.status, 1);
  assert.match(JSON.parse(invalid.stdout).error, /1 到 1000/);

  const logFile = path.join(sandbox.repo, 'state', 'logs', log.files[0].name);
  const raw = fs.readFileSync(logFile, 'utf8');
  assert.equal(raw.includes(marker), false);
  assert.equal(raw.includes(os.hostname()), true);
  assert.equal(raw.split('\n').filter(Boolean).length, log.total);
  assert.equal(fs.readFileSync(rule, 'utf8').includes(marker), true);
});

function readDiagnoseZip(buffer) {
  const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(endOffset, -1, '缺少 ZIP 结尾记录');
  const count = buffer.readUInt16LE(endOffset + 10);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = new Map();
  let offset = centralOffset;

  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, buffer.subarray(dataStart, dataStart + size));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test('diagnose 生成诊断目录与 zip，且不包含机器设置值或内容正文', machineSkip, (t) => {
  const sandbox = makeSandbox(t);
  const secret = 'DIAG-ENV-SECRET-VALUE';
  const bodyMarker = 'DIAG-CONTENT-BODY-MARKER';
  const machineFile = path.join(sandbox.repo, 'machines', `${os.hostname()}.md`);
  fs.appendFileSync(
    machineFile,
    [
      '',
      '## 设置',
      '',
      '```json',
      JSON.stringify(
        { env: { AIWB_DIAG_SECRET: secret }, tools: {}, customTools: {} },
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

  const build = runSandboxCli(sandbox, ['build', '--json']);
  assert.equal(build.status, 0, build.stderr);
  const built = JSON.parse(build.stdout);
  const deploy = runSandboxCli(sandbox, ['deploy', '--tool', 'qoder-cn', '--apply', '--json']);
  assert.equal(deploy.status, 0, deploy.stderr);

  const result = runSandboxCli(sandbox, ['diagnose', '--zip', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const diagnosis = JSON.parse(result.stdout);
  assert.equal(diagnosis.ok, true);
  assert.match(diagnosis.outputDir, /^state\/diagnostics\/diagnose-\d{8}-\d{6}-\d{3}$/);
  assert.match(diagnosis.zip.path, /^state\/diagnostics\/diagnose-\d{8}-\d{6}-\d{3}\.zip$/);
  assert.equal(diagnosis.zip.entries, 6);
  assert.deepEqual(
    diagnosis.files.map((file) => file.name),
    ['README.md', 'summary.json', 'status.json', 'doctor.json', 'log.json', 'paths.json']
  );
  assert.equal(diagnosis.summary.build.contentHash, built.contentHash);
  assert.equal(diagnosis.summary.machine.host, os.hostname());
  assert.equal(diagnosis.summary.paths.tools, 7);
  assert.ok(diagnosis.summary.log.total >= 1);
  assert.equal(Array.isArray(diagnosis.issues), true);

  const outputDir = path.join(sandbox.repo, diagnosis.outputDir);
  const zipPath = path.join(sandbox.repo, diagnosis.zip.path);
  assert.equal(fs.existsSync(outputDir), true);
  assert.equal(fs.existsSync(zipPath), true);
  assert.equal(fs.statSync(zipPath).size, diagnosis.zip.bytes);

  const zipBuffer = fs.readFileSync(zipPath);
  for (const text of [secret, bodyMarker, 'AIWB_DIAG_SECRET']) {
    assert.equal(zipBuffer.includes(Buffer.from(text, 'utf8')), false, `zip 不应包含 ${text}`);
  }

  const entries = readDiagnoseZip(zipBuffer);
  assert.equal(entries.size, 6);
  const prefix = `${path.basename(diagnosis.outputDir)}/`;
  for (const file of diagnosis.files) {
    assert.equal(entries.has(`${prefix}${file.name}`), true, `zip 缺少 ${file.name}`);
  }

  const summary = JSON.parse(entries.get(`${prefix}summary.json`).toString('utf8'));
  assert.equal(summary.format.name, 'aiwb-diagnose');
  assert.equal(summary.redactions.includes('环境变量值'), true);
  assert.equal(summary.deploy.summary.ok >= 1, true);
  const status = JSON.parse(entries.get(`${prefix}status.json`).toString('utf8'));
  assert.equal(status.available, true);
  assert.equal(status.build.contentHash, built.contentHash);
  assert.equal(status.targets.find((target) => target.id === 'qoder-cn').state, 'ok');
  const log = JSON.parse(entries.get(`${prefix}log.json`).toString('utf8'));
  assert.equal(log.available, true);
  assert.equal(log.entries.some((entry) => entry.action === 'deploy'), true);
  const doctor = JSON.parse(entries.get(`${prefix}doctor.json`).toString('utf8'));
  assert.equal(doctor.available, true);
  assert.equal(Array.isArray(doctor.checks), true);
  const paths = JSON.parse(entries.get(`${prefix}paths.json`).toString('utf8'));
  assert.equal(paths.machineFile.path, machineFile);
  assert.equal(
    paths.targets.some((target) => target.id === 'qoder-cn' && target.entryPath === sandbox.entryPath),
    true
  );
  assert.equal(paths.targets.find((target) => target.id === 'qoder-cn').entryExists, true);

  for (const content of entries.values()) {
    const text = content.toString('utf8');
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes(bodyMarker), false);
    assert.equal(text.includes('AIWB_DIAG_SECRET'), false);
  }

  const dirOnly = runSandboxCli(sandbox, ['diagnose', '--json']);
  assert.equal(dirOnly.status, 0, dirOnly.stderr);
  const dirOnlyResult = JSON.parse(dirOnly.stdout);
  assert.equal(dirOnlyResult.zip, null);
  assert.match(dirOnlyResult.outputDir, /^state\/diagnostics\/diagnose-\d{8}-\d{6}-\d{3}(-\d+)?$/);
  assert.notEqual(dirOnlyResult.outputDir, diagnosis.outputDir);
  assert.equal(fs.existsSync(path.join(sandbox.repo, dirOnlyResult.outputDir, 'README.md')), true);

  const human = runSandboxCli(sandbox, ['diagnose', '--zip']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /诊断包已生成/);
  assert.match(human.stdout, /压缩包/);
  assert.match(human.stdout, /本机路径与主机名/);
});

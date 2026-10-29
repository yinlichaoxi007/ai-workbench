import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = path.join(repoRoot, 'src', 'cli', 'main.mjs');

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, AIWB_DEBUG: '' }
  });
}

test('build 与 build --check 真实跑通', () => {
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

test('deploy --dry-run 输出完整预演且不写外部文件', () => {
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
});

test('deploy --apply 明确拒绝，不产生半写入', () => {
  const result = runCli(['deploy', '--apply', '--json']);
  assert.equal(result.status, 1);
  const data = JSON.parse(result.stdout);
  assert.equal(data.ok, false);
  assert.match(data.error, /尚未实现/);
});

test('content lint 通过且脚手架预演不落盘', () => {
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

test('status 与 doctor --parity 可读取', () => {
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

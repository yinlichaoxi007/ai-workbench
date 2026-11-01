import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  logFilePath,
  normalizeLogLimit,
  readOperations,
  recordOperations
} from '../../src/core/lib/operation-log.mjs';

function makeRepo(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-operation-log-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  return repo;
}

test('操作记录写入月度文件并只保留白名单字段', (t) => {
  const repo = makeRepo(t);
  const now = new Date(2026, 10, 2, 10, 30, 0);
  const result = recordOperations(
    { repoRoot: repo, now, source: 'gui' },
    [
      {
        action: 'deploy',
        tool: 'qoder-cn',
        target: 'D:\\tools\\AGENTS.md',
        result: 'written',
        backup: 'state/backups/qoder-cn/20261102-103000-000/AGENTS.md',
        content: '不应写入日志的正文',
        detail: {
          created: 2,
          content: '正文',
          token: 'secret-token',
          note: 'ok'
        }
      }
    ]
  );

  assert.equal(result.recorded, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.file, 'state/logs/deploy-202611.jsonl');

  const filePath = path.join(repo, 'state', 'logs', 'deploy-202611.jsonl');
  assert.equal(fs.existsSync(filePath), true);
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);

  const record = JSON.parse(lines[0]);
  assert.equal(record.v, 1);
  assert.match(record.at, /^2026-11-02T10:30:00[+-]\d{2}:\d{2}$/);
  assert.equal(record.action, 'deploy');
  assert.equal(record.source, 'gui');
  assert.equal(record.result, 'written');
  assert.equal(record.tool, 'qoder-cn');
  assert.equal(record.backup, 'state/backups/qoder-cn/20261102-103000-000/AGENTS.md');
  assert.equal(record.detail.created, 2);
  assert.equal(record.detail.note, 'ok');
  assert.equal(record.detail.content, undefined);
  assert.equal(record.detail.token, undefined);
  assert.equal(record.content, undefined);
  assert.equal(lines[0].includes('secret-token'), false);
  assert.equal(lines[0].includes('不应写入日志的正文'), false);
});

test('读取日志按写入顺序倒序并支持条数上限', (t) => {
  const repo = makeRepo(t);
  const first = new Date(2026, 9, 31, 9, 0, 0);
  const second = new Date(2026, 10, 1, 9, 0, 0);
  const third = new Date(2026, 10, 2, 9, 0, 0);

  recordOperations({ repoRoot: repo, now: first, source: 'cli' }, [
    { action: 'backup-create', tool: 'a', result: 'created' }
  ]);
  recordOperations({ repoRoot: repo, now: second, source: 'cli' }, [
    { action: 'deploy', tool: 'b', result: 'written' }
  ]);
  recordOperations({ repoRoot: repo, now: third, source: 'gui' }, [
    { action: 'content-save', target: 'content/rules/01-demo.md', result: 'applied' }
  ]);

  const all = readOperations(repo, { limit: 10 });
  assert.equal(all.total, 3);
  assert.equal(all.entries.length, 3);
  assert.equal(all.truncated, false);
  assert.deepEqual(
    all.entries.map((entry) => entry.action),
    ['content-save', 'deploy', 'backup-create']
  );
  assert.deepEqual(
    all.files.map((file) => file.name),
    ['deploy-202610.jsonl', 'deploy-202611.jsonl']
  );

  const limited = readOperations(repo, { limit: 2 });
  assert.equal(limited.total, 3);
  assert.equal(limited.entries.length, 2);
  assert.equal(limited.truncated, true);
  assert.equal(limited.entries[0].action, 'content-save');
});

test('损坏的日志行被跳过并记录问题', (t) => {
  const repo = makeRepo(t);
  const logsDir = path.join(repo, 'state', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    path.join(logsDir, 'deploy-202611.jsonl'),
    [
      JSON.stringify({ at: '2026-11-01T10:00:00+08:00', action: 'deploy', result: 'written' }),
      '不是 JSON',
      JSON.stringify({ at: '2026-11-01T11:00:00+08:00', action: 'merge' }),
      ''
    ].join('\n'),
    'utf8'
  );

  const result = readOperations(repo, { limit: 10 });
  assert.equal(result.total, 1);
  assert.equal(result.entries[0].action, 'deploy');
  assert.equal(result.issues.length, 2);
  assert.equal(result.issues[0].line, 2);
  assert.match(result.issues[0].message, /JSON/);
  assert.equal(result.issues[1].line, 3);
  assert.match(result.issues[1].message, /缺少/);
});

test('没有日志目录时返回空结果', (t) => {
  const repo = makeRepo(t);
  const result = readOperations(repo, { limit: 5 });
  assert.equal(result.entries.length, 0);
  assert.equal(result.total, 0);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.issues, []);
});

test('日志时间按本地月份分文件，条数上限校验', () => {
  assert.equal(
    logFilePath('C:\\repo', new Date(2026, 0, 15, 12, 0, 0)),
    'C:\\repo\\state\\logs\\deploy-202601.jsonl'
  );
  assert.equal(normalizeLogLimit(undefined), 50);
  assert.equal(normalizeLogLimit('20'), 20);
  assert.throws(() => normalizeLogLimit('0'), /1 到 1000/);
  assert.throws(() => normalizeLogLimit('1001'), /1 到 1000/);
  assert.throws(() => normalizeLogLimit('abc'), /1 到 1000/);
});

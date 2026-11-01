import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBuild } from '../../src/core/lib/entry-builder.mjs';
import { listContent, readContent, saveContent } from '../../src/core/lib/content-editor.mjs';
import { sha256 } from '../../src/core/lib/hash.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-content-editor-'));
  const repo = path.join(root, 'repo');
  const globalRoot = path.join(root, 'global');
  const projectsRoot = path.join(root, 'projects');

  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(globalRoot, { recursive: true });
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.cpSync(path.join(repoRoot, 'content'), path.join(repo, 'content'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'VERSION'), path.join(repo, 'VERSION'));
  fs.mkdirSync(path.join(repo, 'machines'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'machines', 'test-host.md'),
    [
      '---',
      'host: test-host',
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

  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  return {
    repo,
    machinePath: path.join(repo, 'machines', 'test-host.md'),
    ctx: { repoRoot: repo, hostname: 'test-host', now: new Date('2026-11-01T00:00:00Z') }
  };
}

test('内容清单列出规则、索引与内置技能', (t) => {
  const { repo } = makeRepo(t);
  const { rules, skills } = listContent(repo);

  const index = rules.find((rule) => rule.name === '00-index');
  assert.equal(index.isIndex, true);
  assert.equal(index.indexed, true);
  assert.match(index.title, /规则/);

  const rule = rules.find((item) => item.name === '01-communication');
  assert.equal(rule.indexed, true);
  assert.match(rule.fileHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(rule.fileHash, sha256(fs.readFileSync(path.join(repo, rule.file))));

  const skill = skills.find((item) => item.name === 'aiwb');
  assert.equal(skill.builtin, true);
  assert.equal(skill.file, 'content/skills/aiwb/SKILL.md');
});

test('读取内容返回完整正文与哈希', (t) => {
  const { repo } = makeRepo(t);
  const result = readContent(repo, { kind: 'rule', name: '01-communication' });

  assert.equal(result.file, 'content/rules/01-communication.md');
  assert.match(result.content, /^# /);
  assert.equal(result.fileHash, sha256(Buffer.from(result.content, 'utf8')));
  assert.equal(result.isIndex, false);
});

test('保存预演只校验不写文件，校验失败时阻止', (t) => {
  const { repo, ctx } = makeRepo(t);
  const filePath = path.join(repo, 'content', 'rules', '01-communication.md');
  const current = readContent(repo, { kind: 'rule', name: '01-communication' });
  const before = fs.readFileSync(filePath);

  const preview = saveContent(ctx, {
    kind: 'rule',
    name: '01-communication',
    content: `${current.content.trimEnd()}\n\n- 预演新增行。\n`
  });
  assert.equal(preview.status, 'preview');
  assert.equal(preview.canApply, true);
  assert.equal(preview.changed, true);
  assert.deepEqual(fs.readFileSync(filePath), before);

  const blocked = saveContent(ctx, {
    kind: 'rule',
    name: '01-communication',
    content: `${current.content.trimEnd()}\n\n- 本机路径 C:\\temp\\file.txt\n`
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.canApply, false);
  assert.equal(blocked.lint.ok, false);
  assert.deepEqual(fs.readFileSync(filePath), before);
});

test('写入必须提供读取时的哈希', (t) => {
  const { repo, ctx } = makeRepo(t);
  const filePath = path.join(repo, 'content', 'rules', '01-communication.md');
  const current = readContent(repo, { kind: 'rule', name: '01-communication' });
  const before = fs.readFileSync(filePath);

  assert.throws(
    () =>
      saveContent(ctx, {
        kind: 'rule',
        name: '01-communication',
        content: `${current.content.trimEnd()}\n\n- 缺少哈希。\n`,
        apply: true
      }),
    /--expected-hash/
  );
  assert.deepEqual(fs.readFileSync(filePath), before);
});

test('保存写入后重建构建，并记录文件与构建哈希', (t) => {
  const { repo, ctx } = makeRepo(t);
  const filePath = path.join(repo, 'content', 'rules', '01-communication.md');
  const current = readContent(repo, { kind: 'rule', name: '01-communication' });
  const next = `${current.content.trimEnd()}\n\n- 正式写入的行。\n`;

  const result = saveContent(ctx, {
    kind: 'rule',
    name: '01-communication',
    content: next,
    apply: true,
    expectedFileHash: current.fileHash
  });

  assert.equal(result.status, 'applied');
  assert.equal(result.ok, true);
  assert.equal(result.fileHash, sha256(Buffer.from(next, 'utf8')));
  assert.equal(result.build.rebuilt, true);
  assert.equal(result.build.entry, 'dist/ENTRY.md');
  assert.equal(fs.readFileSync(filePath, 'utf8'), next);

  const check = checkBuild(repo, { hostname: 'test-host' });
  assert.equal(check.current, true);
  assert.equal(check.contentHash, result.build.contentHash);
});

test('期望哈希过期时拒绝写入', (t) => {
  const { repo, ctx } = makeRepo(t);
  const filePath = path.join(repo, 'content', 'rules', '01-communication.md');
  const current = readContent(repo, { kind: 'rule', name: '01-communication' });
  const before = fs.readFileSync(filePath);

  const result = saveContent(ctx, {
    kind: 'rule',
    name: '01-communication',
    content: `${current.content.trimEnd()}\n\n- 不应写入。\n`,
    apply: true,
    expectedFileHash: `sha256:${'0'.repeat(64)}`
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /已变化/);
  assert.deepEqual(fs.readFileSync(filePath), before);
});

test('内置技能去掉 builtin 后被校验阻止', (t) => {
  const { repo, ctx } = makeRepo(t);
  const current = readContent(repo, { kind: 'skill', name: 'aiwb' });
  const next = current.content.replace(/^builtin: true\r?\n/m, '');

  const result = saveContent(ctx, {
    kind: 'skill',
    name: 'aiwb',
    content: next
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.canApply, false);
  assert.ok(result.lint.errors.some((issue) => /builtin/.test(issue.message)));
});

test('内容未变化时返回 unchanged，不写文件', (t) => {
  const { repo, ctx } = makeRepo(t);
  const current = readContent(repo, { kind: 'rule', name: '01-communication' });
  const before = fs.readFileSync(path.join(repo, current.file));

  const result = saveContent(ctx, {
    kind: 'rule',
    name: '01-communication',
    content: current.content,
    apply: true,
    expectedFileHash: current.fileHash
  });

  assert.equal(result.status, 'unchanged');
  assert.equal(result.changed, false);
  assert.deepEqual(fs.readFileSync(path.join(repo, current.file)), before);
});

test('非法类型、名称与空内容被拒绝', (t) => {
  const { repo, ctx } = makeRepo(t);

  assert.throws(() => readContent(repo, { kind: 'template', name: 'x' }), /rule 或 skill/);
  assert.throws(
    () => readContent(repo, { kind: 'rule', name: '../01-communication' }),
    /规则名称/
  );
  assert.throws(() => readContent(repo, { kind: 'skill', name: '../aiwb' }), /技能名称/);
  assert.throws(
    () => saveContent(ctx, { kind: 'rule', name: '01-communication', content: '  ' }),
    /不能为空/
  );
});

test('构建失败时恢复原文件', (t) => {
  const { repo, ctx, machinePath } = makeRepo(t);
  const filePath = path.join(repo, 'content', 'rules', '01-communication.md');
  const current = readContent(repo, { kind: 'rule', name: '01-communication' });
  const before = fs.readFileSync(filePath);
  fs.renameSync(machinePath, `${machinePath}.bak`);

  assert.throws(
    () =>
      saveContent(ctx, {
        kind: 'rule',
        name: '01-communication',
        content: `${current.content.trimEnd()}\n\n- 构建会失败。\n`,
        apply: true,
        expectedFileHash: current.fileHash
      }),
    /已恢复原文件/
  );
  assert.deepEqual(fs.readFileSync(filePath), before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRule, createSkill } from '../../src/core/lib/scaffold.mjs';
import { lintContent } from '../../src/core/lib/content-checks.mjs';

const INDEX = [
  '# 规则',
  '',
  '## 阅读顺序',
  '',
  '1. `01-test.md`：测试规则。',
  '2. `machines/<主机名>.md`：机器档案。',
  '',
  '## 文件职责',
  '',
  '| 文件 | 职责 |',
  '|---|---|',
  '| `01-test.md` | 测试。 |',
  '| `machines/<主机名>.md` | 机器。 |',
  ''
].join('\n');

const BUILTIN_SKILL = [
  '---',
  'name: aiwb',
  'description: 维护工作台时使用，覆盖规则、技能和部署入口。',
  'builtin: true',
  '---',
  '',
  '# AI 工作台',
  ''
].join('\n');

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-scaffold-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const rulesDir = path.join(root, 'content', 'rules');
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(path.join(rulesDir, '00-index.md'), INDEX, 'utf8');
  fs.writeFileSync(path.join(rulesDir, '01-test.md'), '# 测试\n\n- 规则。\n', 'utf8');

  const skillDir = path.join(root, 'content', 'skills', 'aiwb');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), BUILTIN_SKILL, 'utf8');

  return root;
}

test('新建规则会编号、写入正文并登记索引', (t) => {
  const root = makeRepo(t);
  const result = createRule(root, { slug: 'sample-rule', title: '示例规则' });

  assert.equal(result.file, 'content/rules/02-sample-rule.md');
  assert.equal(fs.existsSync(path.join(root, result.file)), true);

  const content = fs.readFileSync(path.join(root, result.file), 'utf8');
  assert.match(content, /^# 示例规则/m);
  assert.match(content, /## 规则/);

  const index = fs.readFileSync(path.join(root, 'content', 'rules', '00-index.md'), 'utf8');
  assert.match(index, /2\. `02-sample-rule\.md`：示例规则。/);
  assert.match(index, /3\. `machines\/<主机名>\.md`/);
  assert.match(index, /\| `02-sample-rule\.md` \| 待补充。 \|/);
  assert.equal(result.readingOrderUpdated, true);
  assert.equal(result.dutyTableUpdated, true);
  assert.equal(lintContent(root).ok, true);
});

test('新建规则预演不写文件', (t) => {
  const root = makeRepo(t);
  const before = fs.readFileSync(path.join(root, 'content', 'rules', '00-index.md'), 'utf8');
  const result = createRule(root, { slug: 'sample-rule', dryRun: true });

  assert.equal(result.dryRun, true);
  assert.equal(fs.existsSync(path.join(root, result.file)), false);
  const after = fs.readFileSync(path.join(root, 'content', 'rules', '00-index.md'), 'utf8');
  assert.equal(after, before);
});

test('重复规则 slug 被拒绝', (t) => {
  const root = makeRepo(t);

  assert.throws(() => createRule(root, { slug: 'test' }), /规则已存在/);
});

test('索引缺少阅读顺序时拒绝创建，避免漏登记', (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, 'content', 'rules', '00-index.md'), '# 规则\n', 'utf8');

  assert.throws(() => createRule(root, { slug: 'sample-rule' }), /阅读顺序/);
  assert.equal(fs.existsSync(path.join(root, 'content', 'rules', '02-sample-rule.md')), false);
});

test('新建技能生成 SKILL.md 并通过校验', (t) => {
  const root = makeRepo(t);
  const result = createSkill(root, {
    name: 'demo-skill',
    title: '演示技能',
    description: '当用户需要演示技能创建流程时使用'
  });

  assert.equal(result.file, 'content/skills/demo-skill/SKILL.md');
  const content = fs.readFileSync(path.join(root, result.file), 'utf8');
  assert.match(content, /^---\nname: demo-skill\n/);
  assert.match(content, /description: 当用户需要演示技能创建流程时使用/);
  assert.match(content, /# 演示技能/);

  const lint = lintContent(root);
  assert.equal(lint.ok, true);
  assert.equal(lint.skills.some((skill) => skill.name === 'demo-skill'), true);
});

test('新建技能必须提供描述，名称必须合法', (t) => {
  const root = makeRepo(t);

  assert.throws(() => createSkill(root, { name: 'demo-skill' }), /--description/);
  assert.throws(() => createSkill(root, { name: 'Demo_Skill', description: '场景描述文本' }), /小写字母/);
  assert.throws(
    () => createSkill(root, { name: 'aiwb', description: '重复技能目录测试' }),
    /已存在/
  );
});

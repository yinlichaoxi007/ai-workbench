import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lintContent } from '../../src/core/lib/content-checks.mjs';

const VALID_RULE = '# 测试规则\n\n- 规则内容。\n';
const VALID_INDEX = [
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

function makeRepo(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-content-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const rules = options.rules ?? { '01-test.md': VALID_RULE };
  const skills = options.skills ?? { aiwb: BUILTIN_SKILL };
  const index = options.index ?? VALID_INDEX;

  const rulesDir = path.join(root, 'content', 'rules');
  fs.mkdirSync(rulesDir, { recursive: true });
  if (index !== null) {
    fs.writeFileSync(path.join(rulesDir, '00-index.md'), index, 'utf8');
  }
  for (const [name, content] of Object.entries(rules)) {
    fs.writeFileSync(path.join(rulesDir, name), content, 'utf8');
  }

  const skillsDir = path.join(root, 'content', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  for (const [name, content] of Object.entries(skills)) {
    fs.mkdirSync(path.join(skillsDir, name), { recursive: true });
    if (content !== null) {
      fs.writeFileSync(path.join(skillsDir, name, 'SKILL.md'), content, 'utf8');
    }
  }

  return root;
}

test('合法规则与内置技能通过校验', (t) => {
  const root = makeRepo(t);
  const result = lintContent(root);

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rules.length, 1);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].builtin, true);
});

test('规则未登记到索引时报错', (t) => {
  const index = VALID_INDEX.replace('1. `01-test.md`：测试规则。\n', '').replace(
    '| `01-test.md` | 测试。 |\n',
    ''
  );
  const root = makeRepo(t, { index });
  const result = lintContent(root);

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.message.includes('未在 00-index.md')), true);
});

test('索引引用不存在的规则时也报错', (t) => {
  const index = `${VALID_INDEX}3. \`02-missing.md\`：缺失规则。\n`;
  const root = makeRepo(t, { index });
  const result = lintContent(root);

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.message.includes('02-missing.md')), true);
});

test('规则文件名不规范或编号重复时报错', (t) => {
  const rules = {
    '01-test.md': VALID_RULE,
    '1-bad.md': VALID_RULE,
    '01-duplicate.md': VALID_RULE
  };
  const root = makeRepo(t, { rules });
  const result = lintContent(root);

  assert.equal(result.errors.some((error) => error.message.includes('规则文件名应为')), true);
  assert.equal(result.errors.some((error) => error.message.includes('重复')), true);
});

test('缺少内置技能或未标记 builtin 时报错', (t) => {
  const missing = makeRepo(t, { skills: {} });
  const missingResult = lintContent(missing);
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.errors.some((error) => error.message.includes('缺少内置技能')), true);

  const unprotected = makeRepo(t, {
    skills: { aiwb: BUILTIN_SKILL.replace('builtin: true', 'builtin: false') }
  });
  const unprotectedResult = lintContent(unprotected);
  assert.equal(unprotectedResult.ok, false);
  assert.equal(
    unprotectedResult.errors.some((error) => error.message.includes('builtin: true')),
    true
  );
});

test('技能缺少 SKILL.md、name 不一致或描述为空时报错', (t) => {
  const noFile = makeRepo(t, { skills: { aiwb: null } });
  const noFileResult = lintContent(noFile);
  assert.equal(noFileResult.errors.some((error) => error.message.includes('缺少 SKILL.md')), true);

  const wrongName = makeRepo(t, {
    skills: { aiwb: BUILTIN_SKILL.replace('name: aiwb', 'name: other') }
  });
  const wrongNameResult = lintContent(wrongName);
  assert.equal(
    wrongNameResult.errors.some((error) => error.message.includes('与目录名')),
    true
  );

  const noDescription = makeRepo(t, {
    skills: { aiwb: BUILTIN_SKILL.replace(/description: .+/, 'description: ') }
  });
  const noDescriptionResult = lintContent(noDescription);
  assert.equal(
    noDescriptionResult.errors.some((error) => error.message.includes('description')),
    true
  );
});

test('规则或技能正文包含盘符绝对路径时报错', (t) => {
  const root = makeRepo(t, {
    rules: { '01-test.md': '# 测试\n\n- 路径：X:\bench\n' }
  });
  const result = lintContent(root);

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.message.includes('盘符绝对路径')), true);
});

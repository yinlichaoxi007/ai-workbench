import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeText } from '../../src/core/lib/encoding.mjs';
import {
  buildSettingsEnv,
  DEFAULT_BACKUP_RETENTION,
  DEFAULT_GUI_PORT,
  loadSettings,
  normalizeSettingChange,
  parseSettingsText,
  planSettingsUpdate
} from '../../src/core/lib/settings.mjs';
import { expandEnv } from '../../src/core/lib/paths.mjs';

const HOST = 'TEST-HOST';

function makeRepo(t, text = PROFILE) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'machines'), { recursive: true });
  fs.writeFileSync(path.join(root, 'machines', `${HOST}.md`), text, 'utf8');
  return root;
}

const PROFILE = [
  '---',
  `host: ${HOST}`,
  'backupRetention: 4',
  'guiPort: 3210',
  '---',
  '',
  `# ${HOST} 机器档案`,
  '',
  '## 路径',
  '',
  '- 全局工作台：X:\\aiwb',
  '',
  '## 设置',
  '',
  '```json',
  '{',
  '  "custom": { "keep": true },',
  '  "env": { "ROOT": "X:\\\\projects" },',
  '  "tools": {',
  '    "qoder-cn": { "entryPath": "${ROOT}\\\\AGENTS.md" },',
  '    "trae-cn": { "enabled": false, "configRoot": "X:\\\\trae" }',
  '  }',
  '}',
  '```',
  '',
  '## 项目清单',
  '',
  '| 名称 | 路径 |',
  '|---|---|',
  '| demo | X:\\projects\\demo |'
].join('\n');

test('解析 frontmatter 设置与“## 设置”节', (t) => {
  const root = makeRepo(t);
  const loaded = loadSettings(root, HOST);

  assert.equal(loaded.available, true);
  assert.equal(loaded.writable, true);
  assert.equal(loaded.encoding, 'utf-8');
  assert.equal(loaded.backupRetention.value, 4);
  assert.equal(loaded.backupRetention.source, 'machine');
  assert.equal(loaded.guiPort.value, 3210);
  assert.equal(loaded.guiPort.source, 'machine');
  assert.deepEqual(loaded.settings.env, { ROOT: 'X:\\projects' });
  assert.deepEqual(loaded.settings.tools, {
    'qoder-cn': { entryPath: '${ROOT}\\AGENTS.md' },
    'trae-cn': { enabled: false, configRoot: 'X:\\trae' }
  });
  assert.equal(loaded.hasSection, true);
  assert.equal(loaded.hasBlock, true);
  assert.deepEqual(loaded.issues, []);
  assert.equal(loaded.text.includes('## 项目清单'), true);
});

test('缺少设置节时使用默认值且不报错', (t) => {
  const root = makeRepo(
    t,
    ['---', `host: ${HOST}`, '---', '', `# ${HOST}`, '', '## 路径', '', '- 全局工作台：X:\\aiwb'].join('\n')
  );
  const loaded = loadSettings(root, HOST);

  assert.equal(loaded.hasSection, false);
  assert.equal(loaded.hasBlock, false);
  assert.equal(loaded.backupRetention.value, DEFAULT_BACKUP_RETENTION);
  assert.equal(loaded.backupRetention.source, 'default');
  assert.equal(loaded.guiPort.value, DEFAULT_GUI_PORT);
  assert.equal(loaded.guiPort.source, 'default');
  assert.deepEqual(loaded.issues, []);
});

test('非法保留份数、端口和损坏 JSON 只记录问题', (t) => {
  const text = [
    '---',
    `host: ${HOST}`,
    'backupRetention: 0',
    'guiPort: 70000',
    '---',
    '',
    '## 设置',
    '',
    '```json',
    '{ 不是 JSON }',
    '```'
  ].join('\n');
  const root = makeRepo(t, text);
  const loaded = loadSettings(root, HOST);

  assert.equal(loaded.backupRetention.value, DEFAULT_BACKUP_RETENTION);
  assert.equal(loaded.guiPort.value, DEFAULT_GUI_PORT);
  assert.equal(loaded.issues.some((issue) => issue.key === 'settings'), true);
  assert.equal(loaded.issues.some((issue) => issue.key === 'backupRetention'), true);
  assert.equal(loaded.issues.some((issue) => issue.key === 'guiPort'), true);
  assert.equal(loaded.hasBlock, true);
});

test('设置节缺少 json 代码块与未知字段给出提示', (t) => {
  const text = [
    '---',
    `host: ${HOST}`,
    '---',
    '',
    '## 设置',
    '',
    '暂无。',
    '',
    '## 其他',
    '',
    '保留'
  ].join('\n');
  const root = makeRepo(t, text);
  const loaded = loadSettings(root, HOST);

  assert.equal(loaded.hasSection, true);
  assert.equal(loaded.hasBlock, false);
  assert.equal(loaded.issues[0].key, 'settings');

  const withUnknown = parseSettingsText(
    ['---', `host: ${HOST}`, '---', '', '## 设置', '', '```json', '{"tools":{"qoder-cn":{"color":"red"}}}', '```'].join('\n')
  );
  assert.equal(withUnknown.issues.some((issue) => issue.key === 'tools.qoder-cn.color'), true);
  assert.deepEqual(withUnknown.settings.tools, {});
});

test('机器档案缺失或非 UTF-8 时不可写', (t) => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-settings-empty-'));
  t.after(() => fs.rmSync(emptyRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(emptyRoot, 'machines'), { recursive: true });
  const missing = loadSettings(emptyRoot, 'NOPE-HOST');
  assert.equal(missing.available, false);
  assert.equal(missing.writable, false);
  assert.match(missing.issues[0].message, /找不到机器档案/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-settings-utf16-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'machines'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'machines', `${HOST}.md`),
    encodeText(PROFILE, { encoding: 'utf-16le', hasBom: true })
  );
  const utf16 = loadSettings(root, HOST);
  assert.equal(utf16.available, true);
  assert.equal(utf16.writable, false);
  assert.equal(utf16.issues.some((issue) => issue.key === 'encoding'), true);
  assert.throws(() => planSettingsUpdate(utf16, [{ key: 'backupRetention', value: 3 }]), /UTF-8/);
});

test('修改计划保留“## 设置”节以外的正文与未知 JSON 字段', (t) => {
  const root = makeRepo(t);
  const loaded = loadSettings(root, HOST);
  const plan = planSettingsUpdate(
    loaded,
    [
      { key: 'backupRetention', value: 7 },
      { key: 'env.AIWB_ROOT', value: 'D:\\work' },
      { key: 'tools.qoder-cn.configRoot', value: 'E:\\qoder' },
      { key: 'tools.qoder-cn.skillsDir', value: '${AIWB_ROOT}\\skills' }
    ],
    { toolIds: ['qoder-cn', 'trae-cn'] }
  );

  assert.deepEqual(
    plan.changes.map((change) => [change.key, change.action]),
    [
      ['backupRetention', 'update'],
      ['env.AIWB_ROOT', 'set'],
      ['tools.qoder-cn.configRoot', 'set'],
      ['tools.qoder-cn.skillsDir', 'set']
    ]
  );
  assert.equal(plan.backupRetention.value, 7);
  assert.equal(plan.backupRetention.source, 'machine');
  assert.equal(plan.settings.env.ROOT, 'X:\\projects');
  assert.equal(plan.settings.env.AIWB_ROOT, 'D:\\work');
  assert.deepEqual(plan.issues, []);

  const reparsed = parseSettingsText(plan.nextText);
  assert.equal(reparsed.meta.host, HOST);
  assert.equal(reparsed.meta.backupRetention, 7);
  assert.equal(reparsed.body.includes('# TEST-HOST 机器档案'), true);
  assert.equal(reparsed.body.includes('- 全局工作台：X:\\aiwb'), true);
  assert.equal(reparsed.body.includes('| demo | X:\\projects\\demo |'), true);
  assert.deepEqual(reparsed.raw.custom, { keep: true });
  assert.equal(reparsed.settings.tools['qoder-cn'].entryPath, '${ROOT}\\AGENTS.md');
  assert.equal(plan.nextText.includes('"keep": true'), true);
});

test('删除环境变量与工具覆盖后不留下空对象', (t) => {
  const loaded = loadSettings(makeRepo(t), HOST);
  const plan = planSettingsUpdate(loaded, [
    { key: 'env.ROOT', value: null },
    { key: 'tools.qoder-cn.entryPath', value: null }
  ]);

  assert.deepEqual(
    plan.changes.map((change) => [change.key, change.action]),
    [
      ['env.ROOT', 'unset'],
      ['tools.qoder-cn.entryPath', 'unset']
    ]
  );
  assert.deepEqual(plan.settings.env, {});
  assert.equal(Object.hasOwn(plan.settings.tools, 'qoder-cn'), false);
  assert.deepEqual(plan.settings.tools['trae-cn'], { enabled: false, configRoot: 'X:\\trae' });

  const reparsed = parseSettingsText(plan.nextText);
  assert.deepEqual(reparsed.settings.env, {});
  assert.equal(Object.hasOwn(reparsed.settings.tools, 'qoder-cn'), false);
});

test('解析自定义工具并报告非法定义', (t) => {
  const text = [
    '---',
    `host: ${HOST}`,
    '---',
    '',
    '## 设置',
    '',
    '```json',
    JSON.stringify(
      {
        customTools: {
          'my-tool': {
            name: 'My Tool',
            configRoot: 'X:\\my-tool',
            entryPath: 'X:\\my-tool\\AGENTS.md',
            strategy: 'separate-file',
            format: 'mdc',
            skillsDir: 'X:\\my-tool\\skills',
            frontmatter: '---\ndescription: demo\n---',
            enabled: true
          },
          'Bad ID': {
            name: 'Bad'
          },
          broken: 'nope',
          missing: { name: 'Missing' },
          invalid: {
            name: 1,
            configRoot: 'X:\\invalid',
            entryPath: 'X:\\invalid\\AGENTS.md',
            strategy: 'other',
            format: 'html',
            color: 'red'
          }
        }
      },
      null,
      2
    ),
    '```'
  ].join('\n');
  const loaded = loadSettings(makeRepo(t, text), HOST);

  assert.deepEqual(loaded.settings.customTools['my-tool'], {
    name: 'My Tool',
    configRoot: 'X:\\my-tool',
    entryPath: 'X:\\my-tool\\AGENTS.md',
    strategy: 'separate-file',
    format: 'mdc',
    skillsDir: 'X:\\my-tool\\skills',
    frontmatter: '---\ndescription: demo\n---',
    enabled: true
  });
  assert.equal(Object.hasOwn(loaded.settings.customTools, 'Bad ID'), false);
  assert.equal(Object.hasOwn(loaded.settings.customTools, 'broken'), false);
  assert.equal(loaded.settings.customTools.missing.name, 'Missing');

  const keys = loaded.issues.map((issue) => issue.key);
  assert.ok(keys.includes('customTools.Bad ID'));
  assert.ok(keys.includes('customTools.broken'));
  assert.ok(keys.includes('customTools.missing'));
  assert.match(
    loaded.issues.find((issue) => issue.key === 'customTools.missing').message,
    /缺少必填项：configRoot、entryPath/
  );
  assert.ok(keys.includes('customTools.invalid.name'));
  assert.ok(keys.includes('customTools.invalid.strategy'));
  assert.ok(keys.includes('customTools.invalid.format'));
  assert.ok(keys.includes('customTools.invalid.color'));
});

test('版本要求归一化、写入与清除', (t) => {
  const root = makeRepo(t);
  const machinePath = path.join(root, 'machines', `${HOST}.md`);
  const loaded = loadSettings(root, HOST);
  const plan = planSettingsUpdate(loaded, [
    { key: 'tools.qoder-cn.version', value: 'v1.2.3,<2 || 2.0.0' },
    { key: 'customTools.my-tool.name', value: 'My Tool' },
    { key: 'customTools.my-tool.configRoot', value: 'X:\\my-tool' },
    { key: 'customTools.my-tool.entryPath', value: 'X:\\my-tool\\AGENTS.md' },
    { key: 'customTools.my-tool.version', value: 'V2.0.0' }
  ]);

  assert.equal(plan.changes[0].to, '1.2.3,<2 || 2.0.0');
  assert.equal(plan.settings.tools['qoder-cn'].version, '1.2.3,<2 || 2.0.0');
  assert.equal(plan.settings.customTools['my-tool'].version, '2.0.0');
  assert.deepEqual(plan.issues, []);

  const reparsed = parseSettingsText(plan.nextText);
  assert.equal(reparsed.settings.tools['qoder-cn'].version, '1.2.3,<2 || 2.0.0');
  assert.equal(reparsed.settings.customTools['my-tool'].version, '2.0.0');

  fs.writeFileSync(machinePath, plan.nextText, 'utf8');
  const cleared = planSettingsUpdate(loadSettings(root, HOST), [
    { key: 'tools.qoder-cn.version', value: '' },
    { key: 'customTools.my-tool.version', value: '' }
  ]);
  assert.deepEqual(
    cleared.changes.map((change) => [change.key, change.action, change.to]),
    [
      ['tools.qoder-cn.version', 'unset', null],
      ['customTools.my-tool.version', 'unset', null]
    ]
  );
  assert.equal(Object.hasOwn(cleared.settings.tools['qoder-cn'], 'version'), false);
  assert.equal(Object.hasOwn(cleared.settings.customTools['my-tool'], 'version'), false);
  assert.equal(cleared.settings.customTools['my-tool'].name, 'My Tool');
});

test('非法版本要求记录问题并忽略', (t) => {
  const text = [
    '---',
    `host: ${HOST}`,
    '---',
    '',
    '## 设置',
    '',
    '```json',
    JSON.stringify({
      tools: { 'qoder-cn': { version: '1.2 3' }, 'trae-cn': { version: 2 } },
      customTools: {
        'my-tool': {
          name: 'My Tool',
          configRoot: 'X:\\my-tool',
          entryPath: 'X:\\my-tool\\AGENTS.md',
          version: '1.0.0\n2.0.0'
        }
      }
    }),
    '```'
  ].join('\n');
  const loaded = loadSettings(makeRepo(t, text), HOST);
  const keys = loaded.issues.map((issue) => issue.key);

  assert.ok(keys.includes('tools.qoder-cn.version'));
  assert.ok(keys.includes('tools.trae-cn.version'));
  assert.ok(keys.includes('customTools.my-tool.version'));
  assert.equal(Object.hasOwn(loaded.settings.tools, 'qoder-cn'), false);
  assert.equal(Object.hasOwn(loaded.settings.tools, 'trae-cn'), false);
  assert.equal(Object.hasOwn(loaded.settings.customTools['my-tool'], 'version'), false);

  assert.equal(normalizeSettingChange('tools.qoder-cn.version', '').value, null);
  assert.equal(normalizeSettingChange('customTools.my-tool.version', 'v3.0.0').value, '3.0.0');
  assert.equal(
    normalizeSettingChange('tools.qoder-cn.version', '>=1.2,<2 || 3.0').value,
    '>=1.2,<2 || 3.0'
  );
  assert.equal(
    normalizeSettingChange('customTools.my-tool.version', '>=1,(<2||3.0)').value,
    '>=1,(<2 || 3.0)'
  );
  assert.throws(() => normalizeSettingChange('tools.qoder-cn.version', '1.0\n2.0'), /换行/);
  assert.throws(() => normalizeSettingChange('customTools.my-tool.version', '1.0 2.0'), /不合法/);
  assert.throws(
    () => normalizeSettingChange('customTools.my-tool.version', '(1.0'),
    /缺少右括号/
  );
});

test('自定义工具设置项校验', () => {
  assert.deepEqual(normalizeSettingChange('customTools.my-tool.enabled', 'false'), {
    kind: 'custom',
    key: 'customTools.my-tool.enabled',
    toolId: 'my-tool',
    field: 'enabled',
    value: false
  });
  assert.equal(normalizeSettingChange('customTools.my-tool.skillsDir', '').value, null);
  assert.equal(normalizeSettingChange('customTools.my-tool', null).field, null);
  assert.throws(() => normalizeSettingChange('customTools.Bad.enabled', true), /小写字母/);
  assert.throws(() => normalizeSettingChange('customTools.my-tool', 'value'), /删除整个工具/);
  assert.throws(() => normalizeSettingChange('customTools.my-tool.strategy', 'other'), /block-append/);
  assert.throws(() => normalizeSettingChange('customTools.my-tool.format', 'html'), /markdown/);
  assert.throws(() => normalizeSettingChange('customTools.my-tool.unknown', 'x'), /字段不合法/);
  assert.throws(() => normalizeSettingChange('customTools.my-tool.name', 'a\nb'), /换行/);
  assert.throws(() => normalizeSettingChange('customTools.my-tool.configRoot', ''), /非空/);
});

test('新增、修改并删除自定义工具，保留其他设置', (t) => {
  const root = makeRepo(t);
  const loaded = loadSettings(root, HOST);
  const plan = planSettingsUpdate(
    loaded,
    [
      { key: 'customTools.my-tool.name', value: 'My Tool' },
      { key: 'customTools.my-tool.configRoot', value: '${ROOT}\\my-tool' },
      { key: 'customTools.my-tool.entryPath', value: '${ROOT}\\my-tool\\AGENTS.md' },
      { key: 'customTools.my-tool.strategy', value: 'separate-file' },
      { key: 'customTools.my-tool.format', value: 'mdc' },
      { key: 'customTools.my-tool.skillsDir', value: '${ROOT}\\my-tool\\skills' },
      { key: 'customTools.my-tool.frontmatter', value: '---\ndescription: demo\n---' },
      { key: 'customTools.my-tool.enabled', value: false }
    ],
    { toolIds: ['qoder-cn', 'trae-cn'] }
  );

  assert.deepEqual(
    plan.changes.map((change) => [change.key, change.action]),
    [
      ['customTools.my-tool.name', 'set'],
      ['customTools.my-tool.configRoot', 'set'],
      ['customTools.my-tool.entryPath', 'set'],
      ['customTools.my-tool.strategy', 'set'],
      ['customTools.my-tool.format', 'set'],
      ['customTools.my-tool.skillsDir', 'set'],
      ['customTools.my-tool.frontmatter', 'set'],
      ['customTools.my-tool.enabled', 'set']
    ]
  );
  assert.deepEqual(plan.issues, []);
  assert.deepEqual(plan.settings.customTools['my-tool'], {
    name: 'My Tool',
    configRoot: '${ROOT}\\my-tool',
    entryPath: '${ROOT}\\my-tool\\AGENTS.md',
    strategy: 'separate-file',
    format: 'mdc',
    skillsDir: '${ROOT}\\my-tool\\skills',
    frontmatter: '---\ndescription: demo\n---',
    enabled: false
  });

  const reparsed = parseSettingsText(plan.nextText);
  assert.deepEqual(reparsed.issues, []);
  assert.deepEqual(reparsed.settings.customTools['my-tool'], plan.settings.customTools['my-tool']);
  assert.deepEqual(reparsed.raw.custom, { keep: true });
  assert.deepEqual(reparsed.settings.env, { ROOT: 'X:\\projects' });
  assert.deepEqual(reparsed.settings.tools, {
    'qoder-cn': { entryPath: '${ROOT}\\AGENTS.md' },
    'trae-cn': { enabled: false, configRoot: 'X:\\trae' }
  });

  fs.writeFileSync(path.join(root, 'machines', `${HOST}.md`), plan.nextText, 'utf8');
  const reloaded = loadSettings(root, HOST);
  const removed = planSettingsUpdate(reloaded, [{ key: 'customTools.my-tool', value: null }]);
  assert.deepEqual(removed.changes, [
    {
      key: 'customTools.my-tool',
      action: 'unset',
      from: plan.settings.customTools['my-tool'],
      to: null
    }
  ]);
  assert.deepEqual(removed.settings.customTools, {});
  assert.equal(parseSettingsText(removed.nextText).settings.customTools['my-tool'], undefined);
  assert.equal(removed.nextText.includes('"customTools"'), false);
});

test('自定义工具路径、id 冲突与必填项给出问题', (t) => {
  const loaded = loadSettings(makeRepo(t), HOST);
  const relative = planSettingsUpdate(loaded, [
    { key: 'customTools.my-tool.name', value: 'My Tool' },
    { key: 'customTools.my-tool.configRoot', value: 'relative\\config' },
    { key: 'customTools.my-tool.entryPath', value: 'relative\\AGENTS.md' }
  ]);
  const relativeKeys = relative.issues.map((issue) => issue.key);
  assert.ok(relativeKeys.includes('customTools.my-tool.configRoot'));
  assert.ok(relativeKeys.includes('customTools.my-tool.entryPath'));
  assert.match(
    relative.issues.find((issue) => issue.key === 'customTools.my-tool.configRoot').message,
    /绝对路径/
  );

  const missingEnv = planSettingsUpdate(loaded, [
    { key: 'customTools.my-tool.name', value: 'My Tool' },
    { key: 'customTools.my-tool.configRoot', value: '${NOT_DEFINED}\\config' },
    { key: 'customTools.my-tool.entryPath', value: '${NOT_DEFINED}\\AGENTS.md' }
  ]);
  assert.match(
    missingEnv.issues.find((issue) => issue.key === 'customTools.my-tool.configRoot').message,
    /未定义的环境变量：NOT_DEFINED/
  );

  const collision = planSettingsUpdate(
    loaded,
    [
      { key: 'customTools.qoder-cn.name', value: '冲突' },
      { key: 'customTools.qoder-cn.configRoot', value: 'X:\\custom' },
      { key: 'customTools.qoder-cn.entryPath', value: 'X:\\custom\\AGENTS.md' }
    ],
    { toolIds: ['qoder-cn'] }
  );
  assert.match(
    collision.issues.find((issue) => issue.key === 'customTools.qoder-cn').message,
    /与内置目标重复/
  );

  const partial = planSettingsUpdate(loaded, [
    { key: 'customTools.partial.name', value: 'Partial' }
  ]);
  assert.match(
    partial.issues.find((issue) => issue.key === 'customTools.partial').message,
    /缺少必填项：configRoot、entryPath/
  );
});

test('无实际变化时不重写档案文本', (t) => {
  const loaded = loadSettings(makeRepo(t), HOST);
  const plan = planSettingsUpdate(loaded, [
    { key: 'backupRetention', value: 4 },
    { key: 'env.ROOT', value: 'X:\\projects' },
    { key: 'tools.qoder-cn.entryPath', value: '${ROOT}\\AGENTS.md' }
  ]);

  assert.equal(plan.changes.every((change) => change.action === 'unchanged'), true);
  assert.equal(plan.nextText, loaded.text);
});

test('路径覆盖引用未定义环境变量时给出问题', (t) => {
  const loaded = loadSettings(makeRepo(t), HOST);
  const plan = planSettingsUpdate(loaded, [
    { key: 'tools.qoder-cn.skillsDir', value: '${NOT_DEFINED}\\skills' }
  ]);

  const issue = plan.issues.find((item) => item.key === 'tools.qoder-cn.skillsDir');
  assert.ok(issue);
  assert.match(issue.message, /未定义的环境变量：NOT_DEFINED/);
});

test('设置项校验覆盖非法键、值范围和未知工具', () => {
  const toolIds = ['qoder-cn'];
  assert.throws(() => normalizeSettingChange('backupRetention', '0'), />= 1/);
  assert.throws(() => normalizeSettingChange('guiPort', '70000'), /0 到 65535/);
  assert.throws(() => normalizeSettingChange('env.1BAD', 'x'), /不合法/);
  assert.throws(() => normalizeSettingChange('env.A', ''), /非空字符串/);
  assert.throws(() => normalizeSettingChange('env.A', 'x\ny'), /换行/);
  assert.throws(() => normalizeSettingChange('tools.nope.enabled', 'true', { toolIds }), /未知工具/);
  assert.throws(() => normalizeSettingChange('tools.qoder-cn.enabled', 'yes', { toolIds }), /true 或 false/);
  assert.throws(() => normalizeSettingChange('unknown', 'x', { toolIds }), /未知设置项/);
  assert.deepEqual(normalizeSettingChange('tools.qoder-cn.enabled', 'false', { toolIds }), {
    kind: 'tool',
    key: 'tools.qoder-cn.enabled',
    toolId: 'qoder-cn',
    field: 'enabled',
    value: false
  });
});

test('设置环境变量优先于进程环境', () => {
  const env = buildSettingsEnv({ ROOT: 'D:\\from-settings' }, { ROOT: 'C:\\from-process', PATH: 'p' });
  assert.equal(env.ROOT, 'D:\\from-settings');
  assert.equal(env.PATH, 'p');

  const expanded = expandEnv('${ROOT}\\AGENTS.md', env);
  assert.equal(expanded.value, 'D:\\from-settings\\AGENTS.md');
  assert.deepEqual(expanded.missing, []);
});

test('CRLF 与 BOM 档案写回后保持原换行和 BOM', (t) => {
  const text =
    `\uFEFF---\r\nhost: ${HOST}\r\n---\r\n\r\n# ${HOST}\r\n\r\n## 路径\r\n\r\n- 全局工作台：X:\\aiwb\r\n`;
  const root = makeRepo(t, text);
  const loaded = loadSettings(root, HOST);
  assert.equal(loaded.encoding, 'utf-8-bom');

  const plan = planSettingsUpdate(loaded, [
    { key: 'backupRetention', value: 3 },
    { key: 'env.A', value: '1' }
  ]);
  assert.equal(plan.nextText.startsWith('\uFEFF---\r\n'), true);
  assert.equal(
    (plan.nextText.match(/\n/g) ?? []).length,
    (plan.nextText.match(/\r\n/g) ?? []).length
  );
  assert.equal(plan.nextText.includes('## 设置\r\n'), true);

  const reparsed = parseSettingsText(plan.nextText);
  assert.equal(reparsed.backupRetention.value, 3);
  assert.deepEqual(reparsed.settings.env, { A: '1' });
  assert.equal(reparsed.body.includes(`# ${HOST}\r\n`), true);
});

test('已有设置节但没有代码块时补入 JSON 块', (t) => {
  const text = ['---', `host: ${HOST}`, '---', '', '## 设置', '', '待补。', '', '## 其他', '', '保留'].join('\n');
  const loaded = loadSettings(makeRepo(t, text), HOST);
  const plan = planSettingsUpdate(loaded, [{ key: 'guiPort', value: 5088 }]);

  const reparsed = parseSettingsText(plan.nextText);
  assert.equal(reparsed.hasBlock, true);
  assert.equal(reparsed.guiPort.value, 5088);
  assert.equal(reparsed.body.includes('待补。'), true);
  assert.equal(reparsed.body.includes('## 其他'), true);
  assert.equal(reparsed.body.includes('保留'), true);
});

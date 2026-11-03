import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadTargets,
  resolveAccountEntry
} from '../../src/core/lib/target-registry.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = 'TEST-HOST';
const TEST_UID = '11111111-2222-3333-4444-555555555555';
const TEST_NOW = 1_800_000_000_000;

function makeSandbox(t, customTools, extraSettings = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-targets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'adapters'), { recursive: true });
  fs.mkdirSync(path.join(root, 'machines'), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, 'adapters', 'targets.json'),
    path.join(root, 'adapters', 'targets.json')
  );
  const text = [
    '---',
    `host: ${HOST}`,
    '---',
    '',
    '## 路径',
    '',
    '- 全局工作台：X:\\aiwb',
    '',
    '## 设置',
    '',
    '```json',
    JSON.stringify({ ...extraSettings, customTools }, null, 2),
    '```'
  ].join('\n');
  fs.writeFileSync(path.join(root, 'machines', `${HOST}.md`), text, 'utf8');
  return root;
}

function writeAccountSnapshot(configRoot, overrides = {}) {
  const snapshotPath = path.join(
    configRoot,
    'storage',
    'skeleton',
    'account-snapshot.json'
  );
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        primary: {
          version: 1,
          uid: TEST_UID,
          nickname: '测试账号',
          type: 'personal',
          savedAt: TEST_NOW - 1000,
          ...overrides
        }
      },
      null,
      2
    ),
    'utf8'
  );
  return snapshotPath;
}

function customTool(root, overrides = {}) {
  const configRoot = path.join(root, 'custom-tool');
  return {
    name: 'My Tool',
    configRoot,
    entryPath: path.join(configRoot, 'AGENTS.md'),
    strategy: 'block-append',
    format: 'markdown',
    ...overrides
  };
}

test('加载全部目标并展开 home 路径', () => {
  const tools = loadTargets(repoRoot);

  assert.equal(tools.length, 7);
  assert.deepEqual(
    tools.map((tool) => tool.id),
    ['qoder-cn', 'trae-cn', 'codebuddy', 'qwenwork-cn', 'workbuddy', 'claude-code', 'codex']
  );

  const qoder = tools.find((tool) => tool.id === 'qoder-cn');
  assert.equal(qoder.enabled, true);
  assert.equal(qoder.installed, true);
  assert.equal(qoder.entryPath.includes('~'), false);
  assert.match(qoder.entryPath, /\.qoder-cn[\\/]AGENTS\.md$/);
});

test('预留工具不参与部署', () => {
  const tools = loadTargets(repoRoot);
  const claude = tools.find((tool) => tool.id === 'claude-code');
  const codex = tools.find((tool) => tool.id === 'codex');

  assert.equal(claude.enabled, false);
  assert.equal(claude.installed, false);
  assert.equal(codex.enabled, false);
  assert.equal(codex.installed, false);
});

test('WorkBuddy 使用账号记忆注入与拆分文件', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-workbuddy-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const configRoot = path.join(base, 'config');
  const root = makeSandbox(t, {}, { tools: { workbuddy: { configRoot } } });
  writeAccountSnapshot(configRoot);

  const workbuddy = loadTargets(root, { hostname: HOST, now: TEST_NOW }).find(
    (tool) => tool.id === 'workbuddy'
  );

  assert.equal(workbuddy.enabled, true);
  assert.equal(workbuddy.entry.strategy, 'memory-block');
  assert.equal(workbuddy.entryPathSource, 'account');
  assert.equal(workbuddy.entryPathProblem, null);
  assert.equal(
    workbuddy.entryPath,
    path.join(configRoot, `user-${TEST_UID}-personal`, 'MEMORY.md')
  );
  assert.equal(workbuddy.entry.placement, 'top');
  assert.deepEqual(workbuddy.entry.markers, {
    begin: '<!-- USER-GLOBAL-RULES:BEGIN -->',
    end: '<!-- USER-GLOBAL-RULES:END -->'
  });
  assert.deepEqual(workbuddy.entry.budget, {
    injectLimit: 4000,
    targetLimit: 3400,
    blockBudget: 600
  });
  assert.equal(
    workbuddy.entry.splitFilePath,
    path.join(configRoot, 'memory', 'ai-workbench-global-rules.md')
  );
});

test('账号目录按快照动态生成，支持企业作用域', (t) => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-account-'));
  t.after(() => fs.rmSync(configRoot, { recursive: true, force: true }));
  const spec = {
    fallbackPath: path.join(configRoot, 'MEMORY.md'),
    accountDir: {
      snapshot: 'storage/skeleton/account-snapshot.json',
      path: 'user-{uid}-{scope}/MEMORY.md'
    }
  };

  writeAccountSnapshot(configRoot);
  const personal = resolveAccountEntry(spec, configRoot, { now: TEST_NOW });
  assert.equal(personal.source, 'account');
  assert.equal(personal.problem, null);
  assert.equal(
    personal.path,
    path.join(configRoot, `user-${TEST_UID}-personal`, 'MEMORY.md')
  );

  writeAccountSnapshot(configRoot, { enterpriseId: 'ent-42' });
  const enterprise = resolveAccountEntry(spec, configRoot, { now: TEST_NOW });
  assert.equal(
    enterprise.path,
    path.join(configRoot, `user-${TEST_UID}-ent-42`, 'MEMORY.md')
  );

  writeAccountSnapshot(configRoot, { enterpriseId: '   ', type: 'enterprise' });
  const blankEnterprise = resolveAccountEntry(spec, configRoot, { now: TEST_NOW });
  assert.equal(
    blankEnterprise.path,
    path.join(configRoot, `user-${TEST_UID}-personal`, 'MEMORY.md')
  );
});

test('快照缺失、无效或过期时回落到设备根', (t) => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-account-'));
  t.after(() => fs.rmSync(configRoot, { recursive: true, force: true }));
  const spec = {
    fallbackPath: path.join(configRoot, 'MEMORY.md'),
    accountDir: {
      snapshot: 'storage/skeleton/account-snapshot.json',
      path: 'user-{uid}-{scope}/MEMORY.md'
    }
  };
  const snapshotPath = path.join(
    configRoot,
    'storage',
    'skeleton',
    'account-snapshot.json'
  );

  const missing = resolveAccountEntry(spec, configRoot, { now: TEST_NOW });
  assert.equal(missing.source, 'device-root');
  assert.equal(missing.path, spec.fallbackPath);
  assert.equal(missing.problem, null);
  assert.equal(missing.accountDirExists, false);

  fs.mkdirSync(path.join(configRoot, `user-other-0000-personal`), { recursive: true });
  const missingWithDir = resolveAccountEntry(spec, configRoot, { now: TEST_NOW });
  assert.equal(missingWithDir.accountDirExists, true);

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, 'not-json', 'utf8');
  const invalidJson = resolveAccountEntry(spec, configRoot, { now: TEST_NOW });
  assert.equal(invalidJson.source, 'device-root');
  assert.match(invalidJson.problem, /不是有效 JSON/);

  writeAccountSnapshot(configRoot, { version: 2 });
  const invalidSchema = resolveAccountEntry(spec, configRoot, { now: TEST_NOW });
  assert.equal(invalidSchema.source, 'device-root');
  assert.match(invalidSchema.problem, /结构不符合/);

  fs.writeFileSync(snapshotPath, `{"primary":"${'x'.repeat(4096)}"}`, 'utf8');
  const tooLarge = resolveAccountEntry(spec, configRoot, { now: TEST_NOW });
  assert.equal(tooLarge.source, 'device-root');
  assert.match(tooLarge.problem, /4096 字节/);

  writeAccountSnapshot(configRoot, {
    savedAt: TEST_NOW - 30 * 24 * 60 * 60 * 1000
  });
  const exactThreshold = resolveAccountEntry(spec, configRoot, { now: TEST_NOW });
  assert.equal(exactThreshold.source, 'account');

  writeAccountSnapshot(configRoot, {
    savedAt: TEST_NOW - 30 * 24 * 60 * 60 * 1000 - 1
  });
  const stale = resolveAccountEntry(spec, configRoot, { now: TEST_NOW });
  assert.equal(stale.source, 'device-root');
  assert.match(stale.problem, /超过 30 天/);

  writeAccountSnapshot(configRoot, { uid: '../escape' });
  const unsafe = resolveAccountEntry(spec, configRoot, { now: TEST_NOW });
  assert.equal(unsafe.source, 'device-root');
  assert.match(unsafe.problem, /不能作为目录名/);

  writeAccountSnapshot(configRoot);
  const escaping = resolveAccountEntry(
    { ...spec, accountDir: { ...spec.accountDir, path: '../{uid}/MEMORY.md' } },
    configRoot,
    { now: TEST_NOW }
  );
  assert.equal(escaping.source, 'device-root');
  assert.match(escaping.problem, /不在配置目录内/);
});

test('疑似登出或未登录时回落都被标记为阻止部署', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-workbuddy-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const configRoot = path.join(base, 'config');
  const root = makeSandbox(t, {}, { tools: { workbuddy: { configRoot } } });

  const fresh = loadTargets(root, { hostname: HOST, now: TEST_NOW }).find(
    (tool) => tool.id === 'workbuddy'
  );
  assert.equal(fresh.entryPathSource, 'device-root');
  assert.equal(fresh.entryPathBlocked, true);
  assert.match(fresh.entryPathProblem, /未检测到已登录/);
  assert.match(fresh.entryPathProblem, /部署已阻止/);

  fs.mkdirSync(path.join(configRoot, `user-${TEST_UID}-personal`), { recursive: true });
  const loggedOut = loadTargets(root, { hostname: HOST, now: TEST_NOW }).find(
    (tool) => tool.id === 'workbuddy'
  );
  assert.equal(loggedOut.entryPathSource, 'device-root');
  assert.equal(loggedOut.entryPathBlocked, true);
  assert.match(loggedOut.entryPathProblem, /疑似 WorkBuddy 已登出/);
  assert.equal(loggedOut.entryPath, path.join(os.homedir(), '.workbuddy', 'MEMORY.md'));

  writeAccountSnapshot(configRoot);
  const bound = loadTargets(root, { hostname: HOST, now: TEST_NOW }).find(
    (tool) => tool.id === 'workbuddy'
  );
  assert.equal(bound.entryPathSource, 'account');
  assert.equal(bound.entryPathBlocked, false);
  assert.equal(bound.entryPathProblem, null);
});

test('CodeBuddy 使用独立 mdc 文件和 frontmatter 模板', () => {
  const tools = loadTargets(repoRoot);
  const codebuddy = tools.find((tool) => tool.id === 'codebuddy');

  assert.equal(codebuddy.entry.strategy, 'separate-file');
  assert.equal(codebuddy.entry.format, 'mdc');
  assert.equal(fs.existsSync(codebuddy.frontmatterTemplate), true);
});

test('自定义工具并入目标列表，配置目录不存在也可解析', (t) => {
  const skillsDir = path.join(os.tmpdir(), 'aiwb-unused', 'skills');
  const root = makeSandbox(t, {
    'my-tool': customTool(path.join(os.tmpdir(), 'aiwb-unused'), {
      strategy: 'separate-file',
      format: 'mdc',
      skillsDir,
      frontmatter: '---\ndescription: demo\n---',
      enabled: true
    })
  });
  const tools = loadTargets(root, { hostname: HOST });
  const custom = tools.find((tool) => tool.id === 'my-tool');

  assert.equal(tools.length, 8);
  assert.ok(custom);
  assert.equal(custom.custom, true);
  assert.equal(custom.status, 'unverified');
  assert.equal(custom.enabled, true);
  assert.equal(custom.installed, false);
  assert.equal(custom.configRootExists, false);
  assert.equal(custom.entryExists, false);
  assert.equal(custom.usingFallback, false);
  assert.equal(custom.entry.strategy, 'separate-file');
  assert.equal(custom.entry.format, 'mdc');
  assert.equal(custom.frontmatter, '---\ndescription: demo\n---');
  assert.equal(custom.skillsDir, skillsDir);
  assert.equal(custom.skillsDirExists, false);
  assert.equal(custom.overrides.enabled, null);
});

test('自定义工具版本要求与配置目录探测结果比对', (t) => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-custom-version-'));
  t.after(() => fs.rmSync(configRoot, { recursive: true, force: true }));
  const root = makeSandbox(t, {
    'my-tool': customTool(path.dirname(configRoot), {
      configRoot,
      entryPath: path.join(configRoot, 'AGENTS.md'),
      version: 'v1.0.0'
    })
  });
  fs.writeFileSync(
    path.join(configRoot, '.status.json'),
    JSON.stringify({ appVersion: '1.0.0' }),
    'utf8'
  );

  const matched = loadTargets(root, { hostname: HOST }).find((tool) => tool.id === 'my-tool');
  assert.equal(matched.version, '1.0.0');
  assert.equal(matched.overrides.version, null);
  assert.equal(matched.detectedVersion, '1.0.0');
  assert.equal(matched.versionCheck.checked, true);
  assert.equal(matched.versionCheck.status, 'match');
  assert.equal(matched.versionCheck.ok, true);

  fs.writeFileSync(
    path.join(configRoot, '.status.json'),
    JSON.stringify({ appVersion: '2.0.0' }),
    'utf8'
  );
  const mismatched = loadTargets(root, { hostname: HOST }).find(
    (tool) => tool.id === 'my-tool'
  );
  assert.equal(mismatched.detectedVersion, '2.0.0');
  assert.equal(mismatched.versionCheck.status, 'mismatch');
  assert.equal(mismatched.versionCheck.ok, false);
  assert.match(mismatched.versionCheck.reason, /要求 1\.0\.0，检测到 2\.0\.0/);

  fs.rmSync(path.join(configRoot, '.status.json'));
  const unknown = loadTargets(root, { hostname: HOST }).find((tool) => tool.id === 'my-tool');
  assert.equal(unknown.versionCheck.status, 'unknown');
  assert.equal(unknown.versionCheck.ok, false);
  assert.match(unknown.versionCheck.reason, /无法检测当前工具版本/);
});

function patchWorkbuddyRegistry(root, patch) {
  const file = path.join(root, 'adapters', 'targets.json');
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  const workbuddy = registry.tools.find((tool) => tool.id === 'workbuddy');
  patch(workbuddy);
  fs.writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

test('WorkBuddy 记忆配置非法时阻止加载', (t) => {
  const sameRoot = makeSandbox(t, {});
  patchWorkbuddyRegistry(sameRoot, (tool) => {
    tool.entry.splitFile = 'MEMORY.md';
  });
  assert.throws(
    () => loadTargets(sameRoot, { hostname: HOST }),
    /splitFile 不能与 entry\.path 相同/
  );

  const escapeRoot = makeSandbox(t, {});
  patchWorkbuddyRegistry(escapeRoot, (tool) => {
    tool.entry.splitFile = '../rules.md';
  });
  assert.throws(() => loadTargets(escapeRoot, { hostname: HOST }), /不能包含 \.\./);

  const absoluteRoot = makeSandbox(t, {});
  patchWorkbuddyRegistry(absoluteRoot, (tool) => {
    tool.entry.splitFile = 'C:\\rules.md';
  });
  assert.throws(
    () => loadTargets(absoluteRoot, { hostname: HOST }),
    /splitFile 必须是相对配置根的路径/
  );

  const budgetRoot = makeSandbox(t, {});
  patchWorkbuddyRegistry(budgetRoot, (tool) => {
    tool.entry.budget.targetLimit = 5000;
  });
  assert.throws(
    () => loadTargets(budgetRoot, { hostname: HOST }),
    /targetLimit 不能大于 injectLimit/
  );

  const markerRoot = makeSandbox(t, {});
  patchWorkbuddyRegistry(markerRoot, (tool) => {
    tool.entry.markers.begin = '';
  });
  assert.throws(() => loadTargets(markerRoot, { hostname: HOST }), /标记不能为空/);

  const placeholderRoot = makeSandbox(t, {});
  patchWorkbuddyRegistry(placeholderRoot, (tool) => {
    tool.entry.accountDir.path = 'user-{scope}/MEMORY.md';
  });
  assert.throws(
    () => loadTargets(placeholderRoot, { hostname: HOST }),
    /accountDir\.path 必须包含 \{uid\} 占位符/
  );

  const accountEscapeRoot = makeSandbox(t, {});
  patchWorkbuddyRegistry(accountEscapeRoot, (tool) => {
    tool.entry.accountDir.path = '../user-{uid}/MEMORY.md';
  });
  assert.throws(() => loadTargets(accountEscapeRoot, { hostname: HOST }), /不能包含 \.\./);

  const accountAbsoluteRoot = makeSandbox(t, {});
  patchWorkbuddyRegistry(accountAbsoluteRoot, (tool) => {
    tool.entry.accountDir.snapshot = 'C:\\snapshot.json';
  });
  assert.throws(
    () => loadTargets(accountAbsoluteRoot, { hostname: HOST }),
    /accountDir\.snapshot 必须是相对配置根的路径/
  );

  const unknownPlaceholderRoot = makeSandbox(t, {});
  patchWorkbuddyRegistry(unknownPlaceholderRoot, (tool) => {
    tool.entry.accountDir.path = 'user-{uid}-{team}/MEMORY.md';
  });
  assert.throws(
    () => loadTargets(unknownPlaceholderRoot, { hostname: HOST }),
    /只支持 \{uid\} 与 \{scope\} 占位符/
  );
});

test('账号目录只用于记忆注入目标', (t) => {
  const root = makeSandbox(t, {});
  const file = path.join(root, 'adapters', 'targets.json');
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  registry.tools.find((tool) => tool.id === 'qoder-cn').entry.accountDir = {
    snapshot: 'snapshot.json',
    path: 'user-{uid}/MEMORY.md'
  };
  fs.writeFileSync(file, JSON.stringify(registry, null, 2), 'utf8');

  assert.throws(
    () => loadTargets(root, { hostname: HOST }),
    /accountDir 只支持 memory-block/
  );
});

test('自定义工具不能使用记忆注入', (t) => {
  const root = makeSandbox(t, {
    'my-tool': customTool(path.join(os.tmpdir(), 'aiwb-memory-custom'), {
      strategy: 'memory-block'
    })
  });

  assert.throws(
    () => loadTargets(root, { hostname: HOST }),
    /strategy 只能是 block-append 或 separate-file/
  );
});

test('自定义工具 id 冲突、无效字段与解析问题阻止加载', (t) => {
  const collisionRoot = makeSandbox(t, { 'qoder-cn': customTool(path.join(os.tmpdir(), 'collision')) });
  assert.throws(
    () => loadTargets(collisionRoot, { hostname: HOST }),
    /自定义工具 id 与内置目标重复：qoder-cn/
  );

  const strategyRoot = makeSandbox(t, {
    'bad-tool': customTool(path.join(os.tmpdir(), 'strategy'), { strategy: 'other' })
  });
  assert.throws(
    () => loadTargets(strategyRoot, { hostname: HOST }),
    /customTools\.bad-tool\.strategy 只能是 block-append 或 separate-file/
  );

  const relativeRoot = makeSandbox(t, {
    'relative-tool': customTool(path.join(os.tmpdir(), 'relative'), {
      entryPath: 'relative\\AGENTS.md'
    })
  });
  assert.throws(
    () => loadTargets(relativeRoot, { hostname: HOST }),
    /entryPath 必须是绝对路径/
  );

  const invalidRoot = makeSandbox(t, { 'Bad ID': customTool(path.join(os.tmpdir(), 'invalid')) });
  assert.throws(
    () => loadTargets(invalidRoot, { hostname: HOST }),
    /自定义工具设置存在问题/
  );
});

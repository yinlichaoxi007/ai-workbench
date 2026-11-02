import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkToolVersion,
  detectToolVersion,
  normalizeVersionSpec,
  normalizeVersionToken
} from '../../src/core/lib/tool-version.mjs';

function makeDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-version-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('版本要求归一化：精确、范围、多候选、括号与去重', () => {
  assert.equal(normalizeVersionSpec(null), null);
  assert.equal(normalizeVersionSpec(undefined), null);
  assert.equal(normalizeVersionSpec(''), null);
  assert.equal(normalizeVersionSpec('   '), null);

  assert.equal(normalizeVersionSpec('v1.2.0').value, '1.2.0');
  assert.equal(normalizeVersionSpec('>= 3.3, < 4').value, '>=3.3,<4');
  assert.equal(normalizeVersionSpec('3.4.13 || 3.5.0').value, '3.4.13 || 3.5.0');
  assert.equal(normalizeVersionSpec('>=1,<2 || 3.0').value, '>=1,<2 || 3.0');
  assert.equal(normalizeVersionSpec('>=1,(<2||3.0)').value, '>=1,(<2 || 3.0)');
  assert.equal(normalizeVersionSpec('((1.2))').value, '1.2');
  assert.equal(normalizeVersionSpec('1.2,1.2').value, '1.2');
  assert.equal(normalizeVersionSpec('1.2||1.2').value, '1.2');
  assert.equal(normalizeVersionSpec('(1||2),3').value, '(1 || 2),3');
  assert.equal(normalizeVersionSpec('>=1').value, '>=1');
  assert.equal(normalizeVersionToken(' v1.2.3 '), '1.2.3');
});

test('版本要求拒绝非法字符、缺失条件、括号错误与超量', () => {
  assert.throws(() => normalizeVersionSpec(1.2), /必须是字符串/);
  assert.throws(() => normalizeVersionSpec('1.2 3'), /版本要求不合法/);
  assert.throws(() => normalizeVersionSpec('1.0.0\n2.0.0'), /不能包含换行/);
  assert.throws(() => normalizeVersionSpec('1.0.0\0'), /不能包含换行/);
  assert.throws(() => normalizeVersionSpec('>='), /每个条件都需要填写版本号/);
  assert.throws(() => normalizeVersionSpec('>=1,,<2'), /每个条件都需要填写版本号/);
  assert.throws(() => normalizeVersionSpec('1||'), /每个条件都需要填写版本号/);
  assert.throws(() => normalizeVersionSpec('1|2'), /多个候选条件请用 \|\| 分隔/);
  assert.throws(() => normalizeVersionSpec('()'), /括号内不能为空/);
  assert.throws(() => normalizeVersionSpec('(>=1'), /缺少右括号/);
  assert.throws(() => normalizeVersionSpec('>=1)'), /存在多余的右括号/);
  assert.throws(() => normalizeVersionSpec('>=abc'), /需要以数字开头/);

  const many = Array.from({ length: 21 }, (_, index) => `>=1.0.${index}`).join(',');
  assert.throws(() => normalizeVersionSpec(many), /最多 20 个/);
  const nested = `${'('.repeat(21)}1.0.0${')'.repeat(21)}`;
  assert.throws(() => normalizeVersionSpec(nested), /括号嵌套最多 20 层/);
});

test('内置工具按探测规则读取版本与构建号', (t) => {
  const root = makeDir(t);
  const product = path.join(root, 'product.json');
  fs.writeFileSync(
    product,
    JSON.stringify({ appVersion: '1.2.3', tronBuildVersion: '456' }),
    'utf8'
  );

  const detected = detectToolVersion(
    {
      versionProbe: {
        label: '安装清单',
        paths: [product],
        field: 'appVersion',
        detailField: 'tronBuildVersion'
      },
      custom: false,
      configRoot: root,
      id: 'demo'
    },
    {}
  );

  assert.equal(detected.detected, '1.2.3');
  assert.equal(detected.detail, '456');
  assert.equal(detected.source, '安装清单');
  assert.equal(detected.problem, null);
});

test('内置工具可用环境变量指定自定义安装根目录', (t) => {
  const root = makeDir(t);
  const install = path.join(root, 'Custom Install');
  fs.mkdirSync(path.join(install, 'resources', 'app'), { recursive: true });
  fs.writeFileSync(
    path.join(install, 'resources', 'app', 'product.json'),
    JSON.stringify({ appVersion: '4.5.6', tronBuildVersion: '789' }),
    'utf8'
  );

  const tool = {
    versionProbe: {
      label: '安装清单',
      paths: [
        path.join(root, 'missing', 'product.json'),
        '%AIWB_DEMO_HOME%/resources/app/product.json'
      ],
      field: 'appVersion',
      detailField: 'tronBuildVersion'
    },
    custom: false,
    configRoot: root,
    id: 'demo'
  };

  const detected = detectToolVersion(tool, { AIWB_DEMO_HOME: install });
  assert.equal(detected.detected, '4.5.6');
  assert.equal(detected.detail, '789');
  assert.equal(detected.problem, null);

  const missing = detectToolVersion(tool, {});
  assert.equal(missing.detected, null);
  assert.match(missing.problem, /AIWB_DEMO_HOME/);
  assert.match(missing.problem, /未定义的环境变量/);
});

test('自定义工具在配置目录通用探测，缺失或损坏只记录问题', (t) => {
  const root = makeDir(t);
  fs.writeFileSync(path.join(root, '.status.json'), JSON.stringify({ version: '3.1.4' }), 'utf8');
  const tool = { versionProbe: null, custom: true, configRoot: root, id: 'demo' };

  const detected = detectToolVersion(tool, {});
  assert.equal(detected.detected, '3.1.4');
  assert.match(detected.source, /\.status\.json/);

  const missingRoot = path.join(root, 'missing');
  fs.mkdirSync(missingRoot);
  const missing = detectToolVersion(
    { versionProbe: null, custom: true, configRoot: missingRoot, id: 'demo' },
    {}
  );
  assert.equal(missing.detected, null);
  assert.match(missing.problem, /未找到版本文件/);

  const brokenRoot = path.join(root, 'broken');
  fs.mkdirSync(brokenRoot);
  fs.writeFileSync(path.join(brokenRoot, '.status.json'), '{ 不是 JSON }', 'utf8');
  const broken = detectToolVersion(
    { versionProbe: null, custom: true, configRoot: brokenRoot, id: 'demo' },
    {}
  );
  assert.equal(broken.detected, null);
  assert.match(broken.problem, /无法解析/);

  const builtIn = detectToolVersion(
    { versionProbe: null, custom: false, configRoot: root, id: 'demo' },
    {}
  );
  assert.match(builtIn.problem, /未配置版本探测规则/);
});

test('版本核对支持精确、区间、多候选、括号与比较符', () => {
  assert.equal(
    checkToolVersion({ version: 'v1.2.3', detectedVersion: '1.2.3' }).status,
    'match'
  );
  assert.equal(
    checkToolVersion({ version: '>=3.3,<4', detectedVersion: '3.4.13' }).status,
    'match'
  );
  assert.equal(
    checkToolVersion({ version: '>=3.3,<4', detectedVersion: '4.0.0' }).status,
    'mismatch'
  );
  assert.equal(
    checkToolVersion({ version: '1.2.3 || 1.2.4', detectedVersion: '1.2.4' }).status,
    'match'
  );
  assert.equal(
    checkToolVersion({ version: '1.2.3 || 1.2.4', detectedVersion: '1.2.5' }).status,
    'mismatch'
  );
  assert.equal(
    checkToolVersion({ version: '>=1,<2 || 3.0.0', detectedVersion: '3.0.0' }).status,
    'match'
  );
  assert.equal(
    checkToolVersion({ version: '>=1,(<2 || 3.0.0)', detectedVersion: '3.0.0' }).status,
    'match'
  );
  assert.equal(
    checkToolVersion({ version: '>=1,(<2 || 3.0.0)', detectedVersion: '2.5.0' }).status,
    'mismatch'
  );
  assert.equal(
    checkToolVersion({ version: '1.2.3,1.2.4', detectedVersion: '1.2.4' }).status,
    'mismatch'
  );
  assert.equal(
    checkToolVersion({ version: '<>1.2.3', detectedVersion: '1.2.4' }).status,
    'match'
  );
  assert.equal(
    checkToolVersion({ version: '<>1.2.3', detectedVersion: 'v1.2.3' }).status,
    'mismatch'
  );
  assert.equal(
    checkToolVersion({ version: '>=3.4', detectedVersion: '3.4.0' }).status,
    'match'
  );
  assert.equal(
    checkToolVersion({ version: '<3.4', detectedVersion: '3.4.0' }).status,
    'mismatch'
  );
  assert.equal(
    checkToolVersion({ version: '<1.2.3', detectedVersion: '1.2.3-beta' }).status,
    'match'
  );
  assert.equal(
    checkToolVersion({ version: '>=1.2.3', detectedVersion: '1.2.3-beta' }).status,
    'mismatch'
  );
  assert.equal(
    checkToolVersion({ version: 'insider', detectedVersion: 'insider' }).status,
    'match'
  );

  const uncomparable = checkToolVersion({
    version: '>=1.2.3',
    detectedVersion: 'insider',
    versionSource: '安装清单'
  });
  assert.equal(uncomparable.status, 'unknown');
  assert.equal(uncomparable.ok, false);
  assert.match(uncomparable.reason, /无法按数值比较/);
  assert.match(uncomparable.reason, /安装清单/);
});

test('版本核对区分未设置、不符、无法检测与非法要求', () => {
  const unchecked = checkToolVersion({ version: null, detectedVersion: '1.0.0' });
  assert.equal(unchecked.checked, false);
  assert.equal(unchecked.status, 'unchecked');
  assert.equal(unchecked.ok, true);

  const mismatch = checkToolVersion({
    version: '1.2.3 || 2.0.0',
    detectedVersion: '2.1.0',
    versionDetail: '999',
    versionSource: '安装清单'
  });
  assert.equal(mismatch.status, 'mismatch');
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason, /要求 1\.2\.3 \|\| 2\.0\.0/);
  assert.match(mismatch.reason, /检测到 2\.1\.0/);
  assert.match(mismatch.reason, /安装清单/);

  const unknown = checkToolVersion({
    version: '1.2.3',
    detectedVersion: null,
    versionProblem: '未找到版本文件'
  });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /无法检测当前工具版本/);
  assert.match(unknown.reason, /未找到版本文件/);

  const invalid = checkToolVersion({ version: '1.2 3', detectedVersion: '1.2.3' });
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.ok, false);
  assert.match(invalid.reason, /不合法/);
});

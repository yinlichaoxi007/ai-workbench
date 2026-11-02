import fs from 'node:fs';
import path from 'node:path';
import { expandPath } from './paths.mjs';

const VERSION_TOKEN = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;
const COMPARABLE_VERSION =
  /^([0-9]+(?:\.[0-9]+)*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MAX_VERSION_CONDITIONS = 20;
const MAX_VERSION_DEPTH = 20;
const COMPARISON_OPERATORS = new Set(['<', '>', '<=', '>=']);
const OPERATOR_PREFIXES = ['<=', '>=', '<>', '<', '>'];
const PRECEDENCE = { or: 1, and: 2, condition: 3 };

const CUSTOM_PROBES = [
  ['.status.json', ['appVersion', 'version']],
  ['.app-status.json', ['appVersion', 'version']],
  ['.{id}-app-status.json', ['appVersion', 'version']],
  ['product.json', ['appVersion', 'version']],
  ['resources/app/product.json', ['appVersion', 'version']],
  ['resources/install-manifest.json', ['appVersion']],
  ['resources/app/package.json', ['version']],
  ['package.json', ['version']]
];

/**
 * 归一化版本要求：空值表示不核对。支持精确版本、比较符、逗号（同时满足）、
 * ||（任一满足）和英文括号；逗号优先级高于 ||。
 * @param {unknown} raw 原始值
 * @returns {{value: string, expression: object}|null} 归一化结果
 */
export function normalizeVersionSpec(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') {
    throw new Error('版本必须是字符串');
  }

  const text = raw.trim();
  if (text === '') return null;
  if (/[\r\n\0]/.test(text)) {
    throw new Error('版本不能包含换行或空字符');
  }

  const expression = parseVersionExpression(text);
  return { value: serializeVersionExpression(expression), expression };
}

/**
 * 去掉版本号开头的 v，便于和安装清单里的版本比较。
 * @param {unknown} value 原始版本
 * @returns {string} 归一化版本
 */
export function normalizeVersionToken(value) {
  return String(value ?? '').trim().replace(/^[vV]/, '');
}

function parseVersionExpression(text) {
  let index = 0;
  let conditionCount = 0;

  function fail(message) {
    throw new Error(`版本要求不合法：${text}。${message}`);
  }

  function skipSpace() {
    while (index < text.length && /\s/.test(text[index])) index += 1;
  }

  function isConditionBoundary(char) {
    return (
      char === undefined ||
      char === ',' ||
      char === '，' ||
      char === '(' ||
      char === ')' ||
      char === '|'
    );
  }

  function parseOr(depth) {
    const items = [parseAnd(depth)];
    for (;;) {
      skipSpace();
      if (text.startsWith('||', index)) {
        index += 2;
        items.push(parseAnd(depth));
        continue;
      }
      if (text[index] === '|') fail('多个候选条件请用 || 分隔');
      return makeVersionNode('or', items);
    }
  }

  function parseAnd(depth) {
    const items = [parsePrimary(depth)];
    for (;;) {
      skipSpace();
      if (text[index] === ',' || text[index] === '，') {
        index += 1;
        items.push(parsePrimary(depth));
        continue;
      }
      return makeVersionNode('and', items);
    }
  }

  function parsePrimary(depth) {
    skipSpace();
    if (text[index] !== '(') return parseCondition();
    if (depth >= MAX_VERSION_DEPTH) fail(`括号嵌套最多 ${MAX_VERSION_DEPTH} 层`);
    index += 1;
    skipSpace();
    if (text[index] === ')') fail('括号内不能为空');
    const node = parseOr(depth + 1);
    skipSpace();
    if (text[index] !== ')') fail('缺少右括号');
    index += 1;
    return node;
  }

  function parseCondition() {
    skipSpace();
    let op = '=';
    for (const candidate of OPERATOR_PREFIXES) {
      if (text.startsWith(candidate, index)) {
        op = candidate;
        index += candidate.length;
        break;
      }
    }
    skipSpace();
    const match = /^[0-9A-Za-z._+-]+/.exec(text.slice(index));
    if (!match) fail('每个条件都需要填写版本号');
    const version = normalizeVersionToken(match[0]);
    index += match[0].length;
    if (!VERSION_TOKEN.test(version)) fail(`版本号不合法：${match[0]}`);
    if (COMPARISON_OPERATORS.has(op) && !parseComparableVersion(version)) {
      fail(`范围条件 ${op}${version} 需要以数字开头的版本号（如 >=1.2.0）`);
    }
    conditionCount += 1;
    if (conditionCount > MAX_VERSION_CONDITIONS) {
      fail(`版本条件最多 ${MAX_VERSION_CONDITIONS} 个`);
    }
    skipSpace();
    if (!isConditionBoundary(text[index])) {
      fail(`版本条件后存在无法识别的内容：${text.slice(index)}`);
    }
    return { type: 'condition', op, version };
  }

  const node = parseOr(0);
  skipSpace();
  if (index < text.length) {
    if (text[index] === ')') fail('存在多余的右括号');
    fail(`存在无法识别的内容：${text.slice(index)}`);
  }
  return node;
}

function makeVersionNode(type, items) {
  const flat = [];
  const seen = new Set();
  for (const item of items) {
    for (const candidate of item.type === type ? item.items : [item]) {
      const key = serializeVersionExpression(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      flat.push(candidate);
    }
  }
  return flat.length === 1 ? flat[0] : { type, items: flat };
}

function serializeVersionExpression(node, parentPrecedence = 0) {
  if (node.type === 'condition') {
    return `${node.op === '=' ? '' : node.op}${node.version}`;
  }
  const precedence = PRECEDENCE[node.type];
  const separator = node.type === 'and' ? ',' : ' || ';
  const text = node.items
    .map((item) => serializeVersionExpression(item, precedence))
    .join(separator);
  return precedence < parentPrecedence ? `(${text})` : text;
}

function parseComparableVersion(value) {
  const match = COMPARABLE_VERSION.exec(normalizeVersionToken(value));
  if (!match) return null;
  return {
    main: match[1].split('.').map((part) => BigInt(part)),
    prerelease: match[2] ? match[2].split('.') : []
  };
}

function compareVersions(left, right) {
  const length = Math.max(left.main.length, right.main.length);
  for (let i = 0; i < length; i += 1) {
    const a = left.main[i] ?? 0n;
    const b = right.main[i] ?? 0n;
    if (a !== b) return a < b ? -1 : 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const count = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < count; i += 1) {
    if (i >= left.prerelease.length) return -1;
    if (i >= right.prerelease.length) return 1;
    const a = left.prerelease[i];
    const b = right.prerelease[i];
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
      const leftNumber = BigInt(a);
      const rightNumber = BigInt(b);
      if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1;
      continue;
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

function evaluateVersionExpression(node, detected) {
  if (node.type === 'condition') return evaluateVersionCondition(node, detected);

  const results = node.items.map((item) => evaluateVersionExpression(item, detected));
  if (node.type === 'and') {
    if (results.includes(false)) return false;
    return results.includes(null) ? null : true;
  }
  if (results.includes(true)) return true;
  return results.includes(null) ? null : false;
}

function evaluateVersionCondition(condition, detected) {
  const candidate = normalizeVersionToken(detected).toLowerCase();
  if (condition.op === '=') return candidate === condition.version.toLowerCase();
  if (condition.op === '<>') return candidate !== condition.version.toLowerCase();

  const expected = parseComparableVersion(condition.version);
  const actual = parseComparableVersion(candidate);
  if (!expected || !actual) return null;

  const order = compareVersions(actual, expected);
  if (condition.op === '<') return order < 0;
  if (condition.op === '>') return order > 0;
  if (condition.op === '<=') return order <= 0;
  return order >= 0;
}

/**
 * 检测工具版本。内置工具按注册表的 versionProbe 读取 JSON；自定义工具在配置目录里做通用探测。
 * 探测失败只返回问题说明，不抛出。
 * @param {{
 *   versionProbe?: {paths: string[], field: string, detailField?: string, label?: string}|null,
 *   custom?: boolean,
 *   configRoot: string,
 *   id: string,
 *   versionProbe?: object|null
 * }} tool 工具
 * @param {Record<string, string|undefined>} [env] 用于展开探测路径的环境变量
 * @returns {{detected: string|null, detail: string|null, source: string|null, path: string|null, problem: string|null}} 检测结果
 */
export function detectToolVersion(tool, env = process.env) {
  const candidates = probeCandidates(tool);
  if (candidates.length === 0) {
    return {
      detected: null,
      detail: null,
      source: null,
      path: null,
      problem: '该工具未配置版本探测规则，无法自动读取版本'
    };
  }

  const problems = [];

  for (const candidate of candidates) {
    let filePath;
    try {
      filePath = expandPath(candidate.path, env);
    } catch (error) {
      problems.push(`${candidate.label}：${error.message}`);
      continue;
    }
    if (!fs.existsSync(filePath)) continue;

    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      problems.push(`${candidate.label}（${filePath}）无法解析：${error.message}`);
      continue;
    }

    const raw = readField(data, candidate.field);
    if (raw === undefined || raw === null || raw === '') {
      problems.push(`${candidate.label}（${filePath}）缺少 ${candidate.field}`);
      continue;
    }
    const detected = typeof raw === 'number' ? String(raw) : raw;
    if (typeof detected !== 'string' || detected.trim() === '' || /[\r\n\0]/.test(detected)) {
      problems.push(`${candidate.label}（${filePath}）的 ${candidate.field} 不是有效版本`);
      continue;
    }

    const detailValue = candidate.detailField ? readField(data, candidate.detailField) : null;
    return {
      detected: detected.trim(),
      detail: formatDetail(detailValue),
      source: candidate.label,
      path: filePath,
      problem: null
    };
  }

  return {
    detected: null,
    detail: null,
    source: null,
    path: null,
    problem:
      problems.length > 0
        ? problems.join('；')
        : `未找到版本文件（已检查：${candidates.map((candidate) => candidate.path).join('、')}）`
  };
}

/**
 * 根据版本要求与检测结果生成核对结论。
 * @param {{
 *   version?: string|null,
 *   detectedVersion?: string|null,
 *   versionDetail?: string|null,
 *   versionSource?: string|null,
 *   versionProblem?: string|null
 * }} tool 工具
 * @returns {{
 *   checked: boolean,
 *   expected: string|null,
 *   detected: string|null,
 *   detail: string|null,
 *   source: string|null,
 *   problem: string|null,
 *   status: 'unchecked'|'match'|'mismatch'|'unknown'|'invalid',
 *   ok: boolean,
 *   reason: string|null
 * }} 核对结论
 */
export function checkToolVersion(tool) {
  let spec;
  try {
    spec = normalizeVersionSpec(tool.version ?? null);
  } catch (error) {
    return {
      checked: true,
      expected: typeof tool.version === 'string' ? tool.version : null,
      detected: tool.detectedVersion ?? null,
      detail: tool.versionDetail ?? null,
      source: tool.versionSource ?? null,
      problem: tool.versionProblem ?? null,
      status: 'invalid',
      ok: false,
      reason: `版本字段不合法：${error.message}`
    };
  }

  const base = {
    checked: spec !== null,
    expected: spec?.value ?? null,
    detected: tool.detectedVersion ?? null,
    detail: tool.versionDetail ?? null,
    source: tool.versionSource ?? null,
    problem: tool.versionProblem ?? null,
    status: 'unchecked',
    ok: true,
    reason: null
  };

  if (!spec) return base;

  if (!base.detected) {
    return {
      ...base,
      status: 'unknown',
      ok: false,
      reason: `已设置版本 ${spec.value}，但无法检测当前工具版本${
        base.problem ? `：${base.problem}` : ''
      }。请安装对应版本，或清空版本要求后再操作。`
    };
  }

  const evaluated = evaluateVersionExpression(spec.expression, base.detected);
  if (evaluated === true) {
    return {
      ...base,
      status: 'match',
      reason: `版本匹配：${base.detected}${base.detail ? `（${base.detail}）` : ''} 满足 ${spec.value}`
    };
  }

  if (evaluated === null) {
    return {
      ...base,
      status: 'unknown',
      ok: false,
      reason: `已设置版本 ${spec.value}，但检测到的版本 ${base.detected}${
        base.detail ? `（${base.detail}）` : ''
      } 无法按数值比较${base.source ? `，来源：${base.source}` : ''}。请确认版本格式，或改用精确版本 / <> 条件，或清空版本要求后再操作。`
    };
  }

  return {
    ...base,
    status: 'mismatch',
    ok: false,
    reason: `版本不符：要求 ${spec.value}，检测到 ${base.detected}${
      base.detail ? `（${base.detail}）` : ''
    }${base.source ? `，来源：${base.source}` : ''}`
  };
}

function probeCandidates(tool) {
  if (tool.versionProbe) {
    const label = tool.versionProbe.label ?? '版本清单';
    return tool.versionProbe.paths.map((rawPath) => ({
      path: rawPath.replaceAll('{configRoot}', tool.configRoot),
      field: tool.versionProbe.field,
      detailField: tool.versionProbe.detailField ?? null,
      label
    }));
  }

  if (!tool.custom) return [];

  return CUSTOM_PROBES.flatMap(([relative, fields]) => {
    const file = relative.replaceAll('{id}', tool.id);
    return fields.map((field) => ({
      path: path.join(tool.configRoot, file),
      field,
      detailField: null,
      label: `配置目录 ${file}`
    }));
  });
}

function readField(data, field) {
  let value = data;
  for (const part of field.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

function formatDetail(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' || /[\r\n\0]/.test(text) ? null : text;
}

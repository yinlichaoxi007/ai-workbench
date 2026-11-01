import fs from 'node:fs';
import path from 'node:path';
import { toPosixPath } from './paths.mjs';
import { formatLocalIso } from './time.mjs';

const LOG_FILE_PATTERN = /^deploy-\d{6}\.jsonl$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;
const MAX_DETAIL_KEYS = 20;
const MAX_DETAIL_VALUE_LENGTH = 300;
const FORBIDDEN_DETAIL_KEYS = new Set([
  'content',
  'text',
  'body',
  'token',
  'secret',
  'password',
  'authorization'
]);

/**
 * 返回指定月份的操作日志路径。
 * @param {string} repoRoot 仓库根目录
 * @param {Date} [now] 时间，默认当前时间
 * @returns {string} 日志文件路径
 */
export function logFilePath(repoRoot, now = new Date()) {
  const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return path.join(repoRoot, 'state', 'logs', `deploy-${month}.jsonl`);
}

/**
 * 校验并返回日志条数上限。
 * @param {unknown} value 原始值
 * @returns {number} 1 到 1000 的整数
 */
export function normalizeLogLimit(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit 必须是 1 到 ${MAX_LIMIT} 的整数：${value}`);
  }
  return limit;
}

/**
 * 追加一批操作记录。只写入白名单字段，失败时返回错误而不抛出。
 * @param {{repoRoot: string, now?: Date, source?: string}} ctx 运行上下文
 * @param {Array<Record<string, unknown>>} entries 待记录的动作
 * @returns {{file: string|null, recorded: number, failed: number, errors: string[]}} 记录结果
 */
export function recordOperations(ctx, entries) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (list.length === 0) {
    return { file: null, recorded: 0, failed: 0, errors: [] };
  }

  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const filePath = logFilePath(ctx.repoRoot, now);
  const at = formatLocalIso(now);
  const source = ctx.source === 'gui' ? 'gui' : 'cli';
  const errors = [];
  let recorded = 0;

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch (error) {
    return { file: null, recorded: 0, failed: list.length, errors: [error.message] };
  }

  for (const entry of list) {
    try {
      const record = buildRecord(entry, { at, source });
      fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
      recorded += 1;
    } catch (error) {
      errors.push(error.message);
    }
  }

  return {
    file: toPosixPath(path.relative(ctx.repoRoot, filePath)),
    recorded,
    failed: list.length - recorded,
    errors
  };
}

/**
 * 读取操作日志，按写入顺序倒序返回。
 * @param {string} repoRoot 仓库根目录
 * @param {{limit?: number}} [options] 读取选项
 * @returns {{logsDir: string, files: Array<{name: string, entries: number, issues: number}>, entries: Array<object>, total: number, limit: number, truncated: boolean, issues: Array<object>}} 日志内容
 */
export function readOperations(repoRoot, options = {}) {
  const limit = normalizeLogLimit(options.limit);
  const logsDir = path.join(repoRoot, 'state', 'logs');
  const files = [];
  const entries = [];
  const issues = [];

  if (!fs.existsSync(logsDir)) {
    return {
      logsDir: toPosixPath(path.relative(repoRoot, logsDir)),
      files,
      entries,
      total: 0,
      limit,
      truncated: false,
      issues
    };
  }

  const names = fs
    .readdirSync(logsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LOG_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const name of names) {
    const filePath = path.join(logsDir, name);
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      issues.push({ file: name, line: null, message: `日志文件无法读取：${error.message}` });
      files.push({ name, entries: 0, issues: 1 });
      continue;
    }

    let valid = 0;
    let fileIssues = 0;
    text.split(/\r?\n/).forEach((line, index) => {
      if (line.trim() === '') return;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        issues.push({ file: name, line: index + 1, message: '不是合法 JSON，已跳过' });
        fileIssues += 1;
        return;
      }
      if (!isLogRecord(parsed)) {
        issues.push({ file: name, line: index + 1, message: '缺少 at、action 或 result，已跳过' });
        fileIssues += 1;
        return;
      }
      entries.push({ ...parsed, file: name });
      valid += 1;
    });

    files.push({ name, entries: valid, issues: fileIssues });
  }

  const total = entries.length;
  entries.reverse();

  return {
    logsDir: toPosixPath(path.relative(repoRoot, logsDir)),
    files,
    entries: entries.slice(0, limit),
    total,
    limit,
    truncated: total > limit,
    issues
  };
}

function buildRecord(entry, { at, source }) {
  if (typeof entry.action !== 'string' || entry.action.trim() === '') {
    throw new Error('日志记录缺少 action');
  }
  if (typeof entry.result !== 'string' || entry.result.trim() === '') {
    throw new Error('日志记录缺少 result');
  }

  const record = {
    v: 1,
    at,
    action: entry.action,
    source,
    result: entry.result
  };
  for (const key of ['tool', 'target', 'backup']) {
    if (typeof entry[key] === 'string' && entry[key] !== '') {
      record[key] = entry[key];
    }
  }
  const detail = sanitizeDetail(entry.detail);
  if (detail) record.detail = detail;
  return record;
}

function sanitizeDetail(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const detail = {};
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (count >= MAX_DETAIL_KEYS) break;
    if (FORBIDDEN_DETAIL_KEYS.has(key)) continue;
    const sanitized = sanitizeDetailValue(item);
    if (sanitized === undefined) continue;
    detail[key] = sanitized;
    count += 1;
  }
  return count > 0 ? detail : null;
}

function sanitizeDetailValue(value) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    return value.length > MAX_DETAIL_VALUE_LENGTH
      ? `${value.slice(0, MAX_DETAIL_VALUE_LENGTH)}…`
      : value;
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_DETAIL_KEYS)
      .map(sanitizeDetailValue)
      .filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

function isLogRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.at === 'string' &&
    typeof value.action === 'string' &&
    typeof value.result === 'string'
  );
}

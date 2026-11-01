import fs from 'node:fs';
import path from 'node:path';
import { decodeText, detectNewline } from './encoding.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { sha256 } from './hash.mjs';
import { expandEnv, expandHome, findMachineFile } from './paths.mjs';

export const SETTINGS_SECTION_TITLE = '设置';
export const DEFAULT_BACKUP_RETENTION = 10;
export const DEFAULT_GUI_PORT = 0;
export const CUSTOM_TOOL_FIELDS = [
  'name',
  'configRoot',
  'entryPath',
  'strategy',
  'format',
  'skillsDir',
  'frontmatter',
  'enabled'
];
export const CUSTOM_TOOL_STRATEGIES = ['block-append', 'separate-file'];
export const CUSTOM_TOOL_FORMATS = ['markdown', 'mdc'];

const TOOL_FIELDS = ['enabled', 'configRoot', 'entryPath', 'skillsDir'];
const PATH_FIELDS = new Set(['configRoot', 'entryPath', 'skillsDir']);
const CUSTOM_PATH_FIELDS = new Set(['configRoot', 'entryPath', 'skillsDir']);
const CUSTOM_REQUIRED_FIELDS = ['name', 'configRoot', 'entryPath'];
const CUSTOM_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FENCED_JSON = /```json[^\r\n]*\r?\n([\s\S]*?)\r?\n```/i;

/**
 * 解析机器档案中的设置节与 frontmatter 设置。
 * 解析失败只记录问题，不抛出，便于设置页展示并修复。
 * @param {string} text 机器档案全文
 * @returns {{
 *   meta: Record<string, string|number|boolean>,
 *   body: string,
 *   raw: Record<string, unknown>,
 *   settings: {
 *     env: Record<string,string>,
 *     tools: Record<string,object>,
 *     customTools: Record<string,object>
 *   },
 *   hasSection: boolean,
 *   hasBlock: boolean,
 *   issues: Array<{key: string, message: string}>,
 *   backupRetention: {value: number, source: string},
 *   guiPort: {value: number, source: string}
 * }} 解析结果
 */
export function parseSettingsText(text) {
  const source = typeof text === 'string' ? text.replace(/^\uFEFF/, '') : '';
  const { meta, body } = parseFrontmatter(source);
  const issues = [];
  const raw = {};
  const env = {};
  const tools = {};
  const customTools = {};
  const section = findSection(body, SETTINGS_SECTION_TITLE);
  let hasBlock = false;

  if (section.found) {
    const match = FENCED_JSON.exec(section.text);
    if (!match) {
      issues.push({
        key: 'settings',
        message: '“## 设置”节缺少 ```json 代码块；本次不应用环境变量与工具覆盖。'
      });
    } else {
      hasBlock = true;
      let parsed;
      try {
        parsed = JSON.parse(match[1]);
      } catch (error) {
        issues.push({
          key: 'settings',
          message: `“## 设置”节的 JSON 无法解析：${error.message}`
        });
      }

      if (parsed !== undefined) {
        if (!isPlainObject(parsed)) {
          issues.push({ key: 'settings', message: '“## 设置”节的 JSON 必须是对象。' });
        } else {
          Object.assign(raw, parsed);
          normalizeEnv(parsed.env, env, issues);
          normalizeTools(parsed.tools, tools, issues);
          normalizeCustomTools(parsed.customTools, customTools, issues);
        }
      }
    }
  }

  return {
    meta,
    body,
    raw,
    settings: { env, tools, customTools },
    hasSection: section.found,
    hasBlock,
    issues,
    backupRetention: normalizeRetention(meta.backupRetention, issues),
    guiPort: normalizeGuiPort(meta.guiPort, issues)
  };
}

/**
 * 读取机器档案并解析设置。
 * @param {string} repoRoot 仓库根目录
 * @param {string} [hostname] 主机名
 * @returns {ReturnType<typeof parseSettingsText> & {
 *   available: boolean,
 *   filePath: string|null,
 *   fileHash: string|null,
 *   text: string|null,
 *   writable: boolean,
 *   encoding: string|null
 * }} 设置读取结果
 */
export function loadSettings(repoRoot, hostname) {
  let filePath;
  try {
    filePath = findMachineFile(repoRoot, hostname);
  } catch (error) {
    return {
      ...emptySettings(),
      available: false,
      filePath: null,
      fileHash: null,
      text: null,
      writable: false,
      encoding: null,
      issues: [{ key: 'machine', message: error.message }]
    };
  }

  const buffer = fs.readFileSync(filePath);
  const decoded = decodeText(buffer);
  const bodyText = decoded.text ?? buffer.toString('utf8');
  const text = decoded.encoding === 'utf-8-bom' ? `\uFEFF${bodyText}` : bodyText;
  const writable = decoded.encoding === 'utf-8' || decoded.encoding === 'utf-8-bom';
  const parsed = parseSettingsText(text);
  const issues = [...parsed.issues];

  if (!writable) {
    issues.unshift({
      key: 'encoding',
      message: `机器档案不是 UTF-8 编码（${decoded.encoding}），设置页不会写入，请先转换编码。`
    });
  }

  return {
    ...parsed,
    issues,
    available: true,
    filePath,
    fileHash: sha256(buffer),
    text,
    writable,
    encoding: decoded.encoding
  };
}

/**
 * 合并进程环境变量与设置节环境变量；设置节优先。
 * @param {Record<string,string>} [explicitEnv] 设置节环境变量
 * @param {Record<string,string|undefined>} [baseEnv] 进程环境变量
 * @returns {Record<string,string|undefined>} 用于路径展开的环境变量
 */
export function buildSettingsEnv(explicitEnv = {}, baseEnv = process.env) {
  return { ...baseEnv, ...explicitEnv };
}

/**
 * 把 key=value 形式的修改归一化并校验。
 * @param {string} key 设置项
 * @param {unknown} rawValue 原始值；null 表示删除覆盖
 * @param {{toolIds?: string[]}} [options] 校验选项
 * @returns {{kind: 'meta'|'env'|'tool'|'custom', key: string, name?: string, toolId?: string, field?: string|null, value: unknown}} 归一化修改
 */
export function normalizeSettingChange(key, rawValue, options = {}) {
  if (key === 'backupRetention') {
    if (rawValue === null) throw new Error('backupRetention 不能删除，请改为设置一个正整数');
    return { kind: 'meta', key, value: parseInteger(rawValue, key, 1, null) };
  }

  if (key === 'guiPort') {
    if (rawValue === null) throw new Error('guiPort 不能删除，请改为设置 0 到 65535 之间的整数');
    return { kind: 'meta', key, value: parseInteger(rawValue, key, 0, 65535) };
  }

  if (key.startsWith('env.')) {
    const name = key.slice('env.'.length);
    if (!ENV_NAME.test(name)) {
      throw new Error(`环境变量名不合法：${name || '（空）'}。只能使用字母、数字和下划线，且不能以数字开头。`);
    }
    if (rawValue === null) return { kind: 'env', key, name, value: null };
    if (typeof rawValue !== 'string' || rawValue.trim() === '') {
      throw new Error(`环境变量 ${name} 的值必须是非空字符串`);
    }
    if (/[\r\n\0]/.test(rawValue)) {
      throw new Error(`环境变量 ${name} 的值不能包含换行或空字符`);
    }
    return { kind: 'env', key, name, value: rawValue.trim() };
  }

  if (key.startsWith('customTools.')) {
    return normalizeCustomToolChange(key, rawValue);
  }

  const match = /^tools\.([^.]+)\.(enabled|configRoot|entryPath|skillsDir)$/.exec(key);
  if (!match) {
    throw new Error(
      `未知设置项：${key}。可用：backupRetention、guiPort、env.<变量名>、tools.<工具 id>.<enabled|configRoot|entryPath|skillsDir>、customTools.<工具 id>[.<字段>]`
    );
  }

  const [, toolId, field] = match;
  if (options.toolIds && !options.toolIds.includes(toolId)) {
    throw new Error(`未知工具：${toolId}。可选：${options.toolIds.join(', ')}`);
  }

  if (field === 'enabled') {
    if (rawValue === null) return { kind: 'tool', key, toolId, field, value: null };
    if (typeof rawValue === 'boolean') {
      return { kind: 'tool', key, toolId, field, value: rawValue };
    }
    if (rawValue === 'true' || rawValue === 'false') {
      return { kind: 'tool', key, toolId, field, value: rawValue === 'true' };
    }
    throw new Error(`${key} 必须是 true 或 false`);
  }

  if (rawValue === null) return { kind: 'tool', key, toolId, field, value: null };
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    throw new Error(`${key} 必须是非空路径字符串`);
  }
  if (/[\r\n\0]/.test(rawValue)) {
    throw new Error(`${key} 不能包含换行或空字符`);
  }
  return { kind: 'tool', key, toolId, field, value: rawValue.trim() };
}

function normalizeCustomToolChange(key, rawValue) {
  const match = /^customTools\.([a-z0-9][a-z0-9-]{0,39})(?:\.([A-Za-z]+))?$/.exec(key);
  if (!match) {
    throw new Error(
      `自定义工具设置项不合法：${key}。id 只能用小写字母、数字和短横线，且以字母或数字开头。`
    );
  }

  const [, toolId, field] = match;
  if (!field) {
    if (rawValue !== null) {
      throw new Error(`自定义工具请按字段设置，例如 customTools.${toolId}.entryPath=<路径>；删除整个工具用 customTools.${toolId}=null。`);
    }
    return { kind: 'custom', key, toolId, field: null, value: null };
  }

  if (!CUSTOM_TOOL_FIELDS.includes(field)) {
    throw new Error(
      `自定义工具 ${toolId} 的字段不合法：${field}。可用：${CUSTOM_TOOL_FIELDS.join('、')}`
    );
  }

  if (rawValue === null) return { kind: 'custom', key, toolId, field, value: null };

  if (field === 'enabled') {
    if (typeof rawValue === 'boolean') {
      return { kind: 'custom', key, toolId, field, value: rawValue };
    }
    if (rawValue === 'true' || rawValue === 'false') {
      return { kind: 'custom', key, toolId, field, value: rawValue === 'true' };
    }
    throw new Error(`${key} 必须是 true 或 false`);
  }

  if (field === 'strategy') {
    if (!CUSTOM_TOOL_STRATEGIES.includes(rawValue)) {
      throw new Error(`${key} 只能是 ${CUSTOM_TOOL_STRATEGIES.join(' 或 ')}`);
    }
    return { kind: 'custom', key, toolId, field, value: rawValue };
  }

  if (field === 'format') {
    if (!CUSTOM_TOOL_FORMATS.includes(rawValue)) {
      throw new Error(`${key} 只能是 ${CUSTOM_TOOL_FORMATS.join(' 或 ')}`);
    }
    return { kind: 'custom', key, toolId, field, value: rawValue };
  }

  if (typeof rawValue !== 'string') {
    throw new Error(`${key} 必须是字符串`);
  }

  if (field === 'frontmatter') {
    if (rawValue.includes('\0')) throw new Error(`${key} 不能包含空字符`);
    if (rawValue.trim() === '') return { kind: 'custom', key, toolId, field, value: null };
    return { kind: 'custom', key, toolId, field, value: rawValue };
  }

  if (rawValue.trim() === '') {
    if (field === 'skillsDir') return { kind: 'custom', key, toolId, field, value: null };
    throw new Error(`${key} 必须是非空字符串`);
  }
  if (/[\r\n\0]/.test(rawValue)) {
    throw new Error(`${key} 不能包含换行或空字符`);
  }
  return { kind: 'custom', key, toolId, field, value: rawValue.trim() };
}

/**
 * 规划设置修改：只生成新档案文本，不写文件。
 * @param {ReturnType<typeof loadSettings>} loaded 当前设置
 * @param {Array<{key: string, value: unknown}>|Record<string, unknown>} changes 修改列表或对象
 * @param {{toolIds?: string[]}} [options] 校验选项
 * @returns {{
 *   changes: Array<{key: string, action: string, from: unknown, to: unknown}>,
 *   settings: {
 *     env: Record<string,string>,
 *     tools: Record<string,object>,
 *     customTools: Record<string,object>
 *   },
 *   meta: Record<string, string|number|boolean>,
 *   backupRetention: {value: number, source: string},
 *   guiPort: {value: number, source: string},
 *   env: Record<string,string|undefined>,
 *   nextText: string,
 *   issues: Array<{key: string, message: string}>
 * }} 修改计划
 */
export function planSettingsUpdate(loaded, changes, options = {}) {
  if (!loaded.available) {
    throw new Error(loaded.issues[0]?.message ?? '机器档案不可用，无法修改设置');
  }
  if (!loaded.writable) {
    throw new Error('机器档案不是 UTF-8 编码，设置页不会写入，请先转换编码');
  }

  const entries = Array.isArray(changes)
    ? changes
    : Object.entries(changes ?? {}).map(([key, value]) => ({ key, value }));
  if (entries.length === 0) {
    throw new Error('没有要修改的设置项');
  }

  const draft = cloneJson(loaded.settings);
  const metaChanges = {};
  const results = [];

  for (const entry of entries) {
    const normalized = normalizeSettingChange(entry.key, entry.value, options);

    if (normalized.kind === 'meta') {
      const before =
        normalized.key === 'backupRetention'
          ? loaded.backupRetention.value
          : loaded.guiPort.value;
      if (before !== normalized.value) {
        metaChanges[normalized.key] = normalized.value;
      }
      results.push({
        key: normalized.key,
        action: before === normalized.value ? 'unchanged' : 'update',
        from: before,
        to: normalized.value
      });
      continue;
    }

    if (normalized.kind === 'env') {
      const before = Object.hasOwn(draft.env, normalized.name) ? draft.env[normalized.name] : null;
      if (normalized.value === null) delete draft.env[normalized.name];
      else draft.env[normalized.name] = normalized.value;
      results.push({
        key: normalized.key,
        action: before === normalized.value ? 'unchanged' : normalized.value === null ? 'unset' : before === null ? 'set' : 'update',
        from: before,
        to: normalized.value
      });
      continue;
    }

    if (normalized.kind === 'custom') {
      if (normalized.field === null) {
        const before = draft.customTools[normalized.toolId] ?? null;
        delete draft.customTools[normalized.toolId];
        results.push({
          key: normalized.key,
          action: before === null ? 'unchanged' : 'unset',
          from: before,
          to: null
        });
        continue;
      }

      const tool = draft.customTools[normalized.toolId] ?? {};
      const before = Object.hasOwn(tool, normalized.field) ? tool[normalized.field] : null;
      if (normalized.value === null) delete tool[normalized.field];
      else tool[normalized.field] = normalized.value;
      if (Object.keys(tool).length === 0) delete draft.customTools[normalized.toolId];
      else draft.customTools[normalized.toolId] = tool;
      results.push({
        key: normalized.key,
        action: before === normalized.value ? 'unchanged' : normalized.value === null ? 'unset' : before === null ? 'set' : 'update',
        from: before,
        to: normalized.value
      });
      continue;
    }

    const tool = draft.tools[normalized.toolId] ?? {};
    const before = Object.hasOwn(tool, normalized.field) ? tool[normalized.field] : null;
    if (normalized.value === null) delete tool[normalized.field];
    else tool[normalized.field] = normalized.value;
    if (Object.keys(tool).length === 0) delete draft.tools[normalized.toolId];
    else draft.tools[normalized.toolId] = tool;
    results.push({
      key: normalized.key,
      action: before === normalized.value ? 'unchanged' : normalized.value === null ? 'unset' : before === null ? 'set' : 'update',
      from: before,
      to: normalized.value
    });
  }

  const effective = results.some((result) => result.action !== 'unchanged');
  const nextText = effective
    ? updateMachineProfileText(loaded.text, {
        metaChanges,
        settings: draft,
        raw: loaded.raw
      })
    : loaded.text;
  const reparsed = parseSettingsText(nextText);
  const issues = [...reparsed.issues];
  const env = buildSettingsEnv(draft.env);

  for (const [toolId, override] of Object.entries(draft.tools)) {
    for (const field of PATH_FIELDS) {
      const value = override[field];
      if (typeof value !== 'string') continue;
      const expanded = expandEnv(value, env);
      if (expanded.missing.length > 0) {
        issues.push({
          key: `tools.${toolId}.${field}`,
          message: `路径引用了未定义的环境变量：${expanded.missing.join('、')}（原值：${value}）`
        });
      }
    }
  }

  for (const toolId of Object.keys(draft.customTools)) {
    if (options.toolIds?.includes(toolId)) {
      issues.push({
        key: `customTools.${toolId}`,
        message: `自定义工具 id 与内置目标重复：${toolId}；请换一个 id，避免部署目标混淆。`
      });
    }
  }

  for (const [toolId, tool] of Object.entries(draft.customTools)) {
    for (const field of CUSTOM_PATH_FIELDS) {
      const value = tool[field];
      if (typeof value !== 'string') continue;
      const expanded = expandEnv(value, env);
      if (expanded.missing.length > 0) {
        issues.push({
          key: `customTools.${toolId}.${field}`,
          message: `路径引用了未定义的环境变量：${expanded.missing.join('、')}（原值：${value}）`
        });
        continue;
      }
      if (!path.isAbsolute(expandHome(expanded.value))) {
        issues.push({
          key: `customTools.${toolId}.${field}`,
          message: `自定义工具路径必须是绝对路径或以 ~ 开头的本机路径（当前：${value}）`
        });
      }
    }
  }

  return {
    changes: results,
    settings: draft,
    meta: reparsed.meta,
    backupRetention: reparsed.backupRetention,
    guiPort: reparsed.guiPort,
    env,
    nextText,
    issues
  };
}

/**
 * 在机器档案原文上只改动 frontmatter 设置键与“## 设置”节，保留其他内容。
 * @param {string} text 原档案
 * @param {{
 *   metaChanges: Record<string, string|number|boolean>,
 *   settings: {env: Record<string,string>, tools: Record<string,object>},
 *   raw: Record<string, unknown>
 * }} options 修改内容
 * @returns {string} 修改后的档案
 */
export function updateMachineProfileText(text, { metaChanges = {}, settings, raw = {} }) {
  const hasBom = text.startsWith('\uFEFF');
  let source = hasBom ? text.slice(1) : text;
  const newline = detectNewline(source);
  const original = source;

  if (Object.keys(metaChanges).length > 0) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(source);
    if (!frontmatter) {
      throw new Error('机器档案缺少 frontmatter，无法写入 backupRetention 或 guiPort');
    }

    const lines = frontmatter[1].split(/\r?\n/);
    for (const [key, value] of Object.entries(metaChanges)) {
      const index = lines.findIndex((line) => {
        const match = /^([ \t]*)([^:#][^:]*):(.*)$/.exec(line);
        return match && match[2].trim() === key;
      });
      const nextLine = `${key}: ${String(value)}`;
      if (index === -1) lines.push(nextLine);
      else lines[index] = nextLine;
    }

    source = source.replace(
      frontmatter[0],
      () => `---${newline}${lines.join(newline)}${newline}---`
    );
  }

  source = writeSettingsSection(source, settings, raw, newline);
  assertProfilePreserved(original, source, metaChanges);

  return `${hasBom ? '\uFEFF' : ''}${source}`;
}

/**
 * 列出设置备份目录；按时间倒序。
 * @param {string} repoRoot 仓库根目录
 * @returns {string[]} 备份目录绝对路径
 */
export function listSettingsBackups(repoRoot) {
  const root = settingsBackupRoot(repoRoot);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => (left < right ? 1 : left > right ? -1 : 0));
}

/**
 * 设置备份根目录。
 * @param {string} repoRoot 仓库根目录
 * @returns {string} 目录路径
 */
export function settingsBackupRoot(repoRoot) {
  return path.join(repoRoot, 'state', 'settings-backups');
}

function emptySettings() {
  return {
    meta: {},
    body: '',
    raw: {},
    settings: { env: {}, tools: {}, customTools: {} },
    hasSection: false,
    hasBlock: false,
    issues: [],
    backupRetention: { value: DEFAULT_BACKUP_RETENTION, source: 'default' },
    guiPort: { value: DEFAULT_GUI_PORT, source: 'default' }
  };
}

function normalizeEnv(value, target, issues) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    issues.push({ key: 'env', message: '“设置”节的 env 必须是对象。' });
    return;
  }

  for (const [name, raw] of Object.entries(value)) {
    if (!ENV_NAME.test(name)) {
      issues.push({ key: `env.${name}`, message: `环境变量名不合法：${name}` });
      continue;
    }
    if (typeof raw !== 'string' || raw.trim() === '') {
      issues.push({ key: `env.${name}`, message: `环境变量 ${name} 的值必须是非空字符串` });
      continue;
    }
    if (/[\r\n\0]/.test(raw)) {
      issues.push({ key: `env.${name}`, message: `环境变量 ${name} 的值不能包含换行或空字符` });
      continue;
    }
    target[name] = raw.trim();
  }
}

function normalizeTools(value, target, issues) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    issues.push({ key: 'tools', message: '“设置”节的 tools 必须是对象。' });
    return;
  }

  for (const [toolId, raw] of Object.entries(value)) {
    if (!isPlainObject(raw)) {
      issues.push({ key: `tools.${toolId}`, message: `工具覆盖 ${toolId} 必须是对象` });
      continue;
    }

    const tool = {};
    for (const [field, fieldValue] of Object.entries(raw)) {
      if (!TOOL_FIELDS.includes(field)) {
        issues.push({
          key: `tools.${toolId}.${field}`,
          message: `工具覆盖 ${toolId} 含未知字段：${field}，已忽略`
        });
        continue;
      }
      if (field === 'enabled') {
        if (typeof fieldValue !== 'boolean') {
          issues.push({
            key: `tools.${toolId}.enabled`,
            message: `tools.${toolId}.enabled 必须是布尔值`
          });
          continue;
        }
        tool[field] = fieldValue;
        continue;
      }
      if (typeof fieldValue !== 'string' || fieldValue.trim() === '') {
        issues.push({
          key: `tools.${toolId}.${field}`,
          message: `tools.${toolId}.${field} 必须是非空路径字符串`
        });
        continue;
      }
      if (/[\r\n\0]/.test(fieldValue)) {
        issues.push({
          key: `tools.${toolId}.${field}`,
          message: `tools.${toolId}.${field} 不能包含换行或空字符`
        });
        continue;
      }
      tool[field] = fieldValue.trim();
    }

    if (Object.keys(tool).length > 0) target[toolId] = tool;
  }
}

function normalizeCustomTools(value, target, issues) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    issues.push({ key: 'customTools', message: '“设置”节的 customTools 必须是对象。' });
    return;
  }

  for (const [toolId, raw] of Object.entries(value)) {
    if (!CUSTOM_ID.test(toolId)) {
      issues.push({
        key: `customTools.${toolId}`,
        message: `自定义工具 id 不合法：${toolId}。只能使用小写字母、数字和短横线，且以字母或数字开头。`
      });
      continue;
    }
    if (!isPlainObject(raw)) {
      issues.push({
        key: `customTools.${toolId}`,
        message: `自定义工具 ${toolId} 的定义必须是对象`
      });
      continue;
    }

    const tool = {};
    for (const [field, fieldValue] of Object.entries(raw)) {
      if (!CUSTOM_TOOL_FIELDS.includes(field)) {
        issues.push({
          key: `customTools.${toolId}.${field}`,
          message: `自定义工具 ${toolId} 含未知字段：${field}，已忽略`
        });
        continue;
      }
      const normalized = normalizeCustomField(toolId, field, fieldValue, issues);
      if (normalized !== undefined) tool[field] = normalized;
    }

    target[toolId] = tool;
    const missing = CUSTOM_REQUIRED_FIELDS.filter((field) => !tool[field]);
    if (missing.length > 0) {
      issues.push({
        key: `customTools.${toolId}`,
        message: `自定义工具 ${toolId} 缺少必填项：${missing.join('、')}`
      });
    }
  }
}

function normalizeCustomField(toolId, field, value, issues) {
  const key = `customTools.${toolId}.${field}`;
  if (field === 'enabled') {
    if (typeof value !== 'boolean') {
      issues.push({ key, message: `${key} 必须是布尔值` });
      return undefined;
    }
    return value;
  }
  if (field === 'strategy') {
    if (!CUSTOM_TOOL_STRATEGIES.includes(value)) {
      issues.push({ key, message: `${key} 只能是 ${CUSTOM_TOOL_STRATEGIES.join(' 或 ')}` });
      return undefined;
    }
    return value;
  }
  if (field === 'format') {
    if (!CUSTOM_TOOL_FORMATS.includes(value)) {
      issues.push({ key, message: `${key} 只能是 ${CUSTOM_TOOL_FORMATS.join(' 或 ')}` });
      return undefined;
    }
    return value;
  }
  if (typeof value !== 'string') {
    issues.push({ key, message: `${key} 必须是字符串` });
    return undefined;
  }
  if (field === 'frontmatter') {
    if (value.includes('\0')) {
      issues.push({ key, message: `${key} 不能包含空字符` });
      return undefined;
    }
    return value;
  }
  if (value.trim() === '') {
    issues.push({ key, message: `${key} 必须是非空字符串` });
    return undefined;
  }
  if (/[\r\n\0]/.test(value)) {
    issues.push({ key, message: `${key} 不能包含换行或空字符` });
    return undefined;
  }
  if (field === 'name' && value.trim().length > 80) {
    issues.push({ key, message: `${key} 不能超过 80 个字符` });
    return undefined;
  }
  return value.trim();
}

function normalizeRetention(raw, issues) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: DEFAULT_BACKUP_RETENTION, source: 'default' };
  }
  const value = Number(raw);
  if (Number.isInteger(value) && value >= 1) {
    return { value, source: 'machine' };
  }
  issues.push({
    key: 'backupRetention',
    message: `backupRetention 必须是大于 0 的整数（当前：${String(raw)}），已按默认 ${DEFAULT_BACKUP_RETENTION} 处理`
  });
  return { value: DEFAULT_BACKUP_RETENTION, source: 'default' };
}

function normalizeGuiPort(raw, issues) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: DEFAULT_GUI_PORT, source: 'default' };
  }
  const value = Number(raw);
  if (Number.isInteger(value) && value >= 0 && value <= 65535) {
    return { value, source: 'machine' };
  }
  issues.push({
    key: 'guiPort',
    message: `guiPort 必须是 0 到 65535 之间的整数（当前：${String(raw)}），已按默认 ${DEFAULT_GUI_PORT} 处理`
  });
  return { value: DEFAULT_GUI_PORT, source: 'default' };
}

function parseInteger(raw, key, min, max) {
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(value) || value < min || (max !== null && value > max)) {
    const range = max === null ? `>= ${min}` : `${min} 到 ${max}`;
    throw new Error(`${key} 必须是 ${range} 的整数（当前：${String(raw)}）`);
  }
  return value;
}

function writeSettingsSection(source, settings, raw, newline) {
  const json = serializeSettings(settings, raw).replace(/\n/g, newline);
  const section = findSection(source, SETTINGS_SECTION_TITLE);

  if (section.found) {
    if (FENCED_JSON.test(section.text)) {
      const nextSection = section.text.replace(
        FENCED_JSON,
        () => `\`\`\`json${newline}${json}${newline}\`\`\``
      );
      return source.slice(0, section.start) + nextSection + source.slice(section.end);
    }

    const before = source.slice(0, section.end);
    const after = source.slice(section.end);
    const leading = before.endsWith('\n') ? newline : `${newline}${newline}`;
    const trailing = after.length === 0 || after.startsWith('\n') ? '' : newline;
    const block = `${leading}\`\`\`json${newline}${json}${newline}\`\`\`${newline}${trailing}`;
    return before + block + after;
  }

  const base = source.replace(/[\r\n]+$/, '');
  const trailing = source.slice(base.length);
  const separator = trailing.length > 0 ? trailing : newline;
  return (
    `${base}${separator}## ${SETTINGS_SECTION_TITLE}${newline}${newline}` +
    `\`\`\`json${newline}${json}${newline}\`\`\`${newline}`
  );
}

function serializeSettings(settings, raw) {
  const payload = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (key === 'env' || key === 'tools' || key === 'customTools') continue;
    payload[key] = value;
  }

  const env = settings.env ?? {};
  if (Object.keys(env).length > 0) {
    payload.env = Object.fromEntries(
      Object.keys(env)
        .sort((left, right) => left.localeCompare(right, 'en'))
        .map((name) => [name, env[name]])
    );
  }

  const tools = settings.tools ?? {};
  if (Object.keys(tools).length > 0) {
    payload.tools = Object.fromEntries(
      Object.keys(tools)
        .sort((left, right) => left.localeCompare(right, 'en'))
        .map((toolId) => {
          const tool = tools[toolId];
          const ordered = {};
          for (const field of TOOL_FIELDS) {
            if (Object.hasOwn(tool, field)) ordered[field] = tool[field];
          }
          return [toolId, ordered];
        })
    );
  }

  const customTools = settings.customTools ?? {};
  if (Object.keys(customTools).length > 0) {
    payload.customTools = Object.fromEntries(
      Object.keys(customTools)
        .sort((left, right) => left.localeCompare(right, 'en'))
        .map((toolId) => {
          const tool = customTools[toolId];
          const ordered = {};
          for (const field of CUSTOM_TOOL_FIELDS) {
            if (Object.hasOwn(tool, field)) ordered[field] = tool[field];
          }
          return [toolId, ordered];
        })
    );
  }

  return JSON.stringify(payload, null, 2);
}

function findSection(text, title) {
  const pattern = new RegExp(`^##[ \\t]+${escapeRegExp(title)}[ \\t]*\\r?$`, 'm');
  const match = pattern.exec(text);
  if (!match) return { found: false, start: -1, end: -1, text: '' };

  const start = match.index;
  const headingEnd = start + match[0].length;
  const rest = text.slice(headingEnd);
  const next = /^##[ \t]+/m.exec(rest);
  const end = next ? headingEnd + next.index : text.length;
  return { found: true, start, end, text: text.slice(start, end) };
}

function stripSettingsSection(body) {
  const section = findSection(body, SETTINGS_SECTION_TITLE);
  if (!section.found) return body;
  return body.slice(0, section.start) + body.slice(section.end);
}

function assertProfilePreserved(before, after, metaChanges) {
  const oldParsed = parseFrontmatter(before);
  const newParsed = parseFrontmatter(after);
  const changedKeys = new Set(Object.keys(metaChanges));

  for (const [key, value] of Object.entries(oldParsed.meta)) {
    if (changedKeys.has(key)) continue;
    if (newParsed.meta[key] !== value) {
      throw new Error(`写回机器档案时意外改动了 frontmatter：${key}`);
    }
  }
  for (const key of Object.keys(newParsed.meta)) {
    if (!changedKeys.has(key) && !Object.hasOwn(oldParsed.meta, key)) {
      throw new Error(`写回机器档案时意外新增了 frontmatter：${key}`);
    }
  }

  const oldBody = stripSettingsSection(oldParsed.body).replace(/[\s]+$/, '');
  const newBody = stripSettingsSection(newParsed.body).replace(/[\s]+$/, '');
  if (oldBody !== newBody) {
    throw new Error('写回机器档案时意外改动了“## 设置”节以外的正文');
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

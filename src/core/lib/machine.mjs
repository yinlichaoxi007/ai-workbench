import fs from 'node:fs';
import os from 'node:os';
import { parseFrontmatter } from './frontmatter.mjs';
import { expandPath, findMachineFile } from './paths.mjs';
import { buildSettingsEnv, parseSettingsText } from './settings.mjs';

/**
 * 读取并解析当前主机的机器档案。
 * @param {string} repoRoot 仓库根目录
 * @param {string} [hostname] 主机名，默认取 os.hostname()
 * @returns {{
 *   host: string,
 *   meta: Record<string, string|number|boolean>,
 *   body: string,
 *   sections: Record<string, string>,
 *   paths: Record<string, string>,
 *   projects: Array<Record<string, string>>,
 *   settings: {
 *     backupRetention: {value: number, source: string},
 *     guiPort: {value: number, source: string},
 *     env: Record<string, string>,
 *     tools: Record<string, object>,
 *     customTools: Record<string, object>,
 *     hasSection: boolean,
 *     issues: Array<{key: string, message: string}>
 *   },
 *   filePath: string
 * }} 机器档案
 */
export function loadMachine(repoRoot, hostname = os.hostname()) {
  const filePath = findMachineFile(repoRoot, hostname);
  const text = fs.readFileSync(filePath, 'utf8');
  const { meta, body } = parseFrontmatter(text);
  const sections = extractSections(body);
  const parsedSettings = parseSettingsText(text);
  const env = buildSettingsEnv(parsedSettings.settings.env);

  const paths = {};
  for (const [key, value] of Object.entries(parseBullets(sections['路径'] ?? ''))) {
    try {
      paths[key] = expandPath(value, env);
    } catch (error) {
      throw new Error(`机器档案“${key}”路径无效：${error.message}`);
    }
  }

  const projects = parseTable(sections['项目清单'] ?? '').map((row) => {
    if (!row['路径']) return row;
    try {
      return { ...row, 路径: expandPath(row['路径'], env) };
    } catch (error) {
      throw new Error(`机器档案项目清单路径无效：${error.message}`);
    }
  });

  return {
    host: String(meta.host || hostname),
    meta,
    body,
    sections,
    paths,
    projects,
    settings: {
      backupRetention: parsedSettings.backupRetention,
      guiPort: parsedSettings.guiPort,
      env: parsedSettings.settings.env,
      tools: parsedSettings.settings.tools,
      customTools: parsedSettings.settings.customTools,
      hasSection: parsedSettings.hasSection,
      issues: parsedSettings.issues
    },
    filePath
  };
}

/**
 * 按二级标题切分 Markdown 正文。
 * @param {string} body Markdown 正文
 * @returns {Record<string, string>} 标题到正文的映射
 */
export function extractSections(body) {
  const sections = {};
  let current = null;

  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1].trim();
      sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
  }

  for (const [key, lines] of Object.entries(sections)) {
    sections[key] = lines.join('\n').trim();
  }
  return sections;
}

/**
 * 解析“- 键：值”形式的列表。
 * 同时接受中文冒号和英文冒号，只取第一个分隔符。
 * @param {string} sectionText 段落正文
 * @returns {Record<string, string>} 键值对
 */
export function parseBullets(sectionText) {
  const result = {};

  for (const line of sectionText.split(/\r?\n/)) {
    const match = /^\s*-\s+(.+)$/.exec(line);
    if (!match) continue;

    const item = match[1];
    const cnIndex = item.indexOf('：');
    const enIndex = item.indexOf(':');
    const separator = cnIndex !== -1 && (enIndex === -1 || cnIndex < enIndex) ? cnIndex : enIndex;
    if (separator <= 0) continue;

    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key && value) result[key] = value;
  }

  return result;
}

/**
 * 解析 Markdown 表格，第一行作为表头，第二行为分隔行。
 * @param {string} sectionText 段落正文
 * @returns {Array<Record<string, string>>} 表格行
 */
export function parseTable(sectionText) {
  const lines = sectionText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));

  if (lines.length < 2) return [];

  const header = splitTableRow(lines[0]);
  const rows = [];

  for (const line of lines.slice(2)) {
    const cells = splitTableRow(line);
    if (cells.length !== header.length) continue;
    rows.push(Object.fromEntries(header.map((key, index) => [key, cells[index]])));
  }
  return rows;
}

function splitTableRow(line) {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

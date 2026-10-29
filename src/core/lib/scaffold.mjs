import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from './fs-safe.mjs';
import { toPosixPath } from './paths.mjs';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RULE_FILE_PATTERN = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

/**
 * 新建规则文件，并登记到 00-index.md 的阅读顺序和文件职责表。
 * @param {string} repoRoot 仓库根目录
 * @param {{slug?: string, title?: string, dryRun?: boolean}} params 规则参数
 * @returns {object} 创建结果
 */
export function createRule(repoRoot, params = {}) {
  const slug = String(params.slug ?? '').trim();
  assertSlug(slug, '规则');

  const rulesDir = path.join(repoRoot, 'content', 'rules');
  if (!fs.existsSync(rulesDir)) {
    throw new Error('缺少 content/rules 目录，请先修复仓库结构');
  }

  const indexPath = path.join(rulesDir, '00-index.md');
  if (!fs.existsSync(indexPath)) {
    throw new Error('缺少 content/rules/00-index.md，请先修复规则索引');
  }

  const fileNames = fs
    .readdirSync(rulesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name);

  if (fileNames.some((fileName) => RULE_FILE_PATTERN.exec(fileName)?.[2] === slug)) {
    throw new Error(`规则已存在：${slug}`);
  }

  const numbers = fileNames
    .map((fileName) => Number(RULE_FILE_PATTERN.exec(fileName)?.[1] ?? 0))
    .filter((number) => number > 0);
  const nextNumber = Math.max(0, ...numbers) + 1;
  if (nextNumber > 99) {
    throw new Error('规则编号已用尽（最多 99 个）');
  }

  const fileName = `${String(nextNumber).padStart(2, '0')}-${slug}.md`;
  const title = singleLine(params.title) || slug;
  const content = ruleTemplate(title);
  const indexText = fs.readFileSync(indexPath, 'utf8');
  const updated = updateIndex(indexText, fileName, title);
  if (!updated.readingOrder) {
    throw new Error('00-index.md 中未找到“## 阅读顺序”编号列表，请先修复索引格式');
  }
  const dryRun = params.dryRun === true;

  if (!dryRun) {
    atomicWriteFile(path.join(rulesDir, fileName), content, 'utf8');
    if (updated.text !== indexText) {
      atomicWriteFile(indexPath, updated.text, 'utf8');
    }
  }

  return {
    subcommand: 'new-rule',
    dryRun,
    file: toPosixPath(path.relative(repoRoot, path.join(rulesDir, fileName))),
    path: path.join(rulesDir, fileName),
    indexFile: toPosixPath(path.relative(repoRoot, indexPath)),
    readingOrderUpdated: updated.readingOrder,
    dutyTableUpdated: updated.dutyTable,
    content
  };
}

/**
 * 新建技能目录和 SKILL.md。
 * @param {string} repoRoot 仓库根目录
 * @param {{name?: string, title?: string, description?: string, dryRun?: boolean}} params 技能参数
 * @returns {object} 创建结果
 */
export function createSkill(repoRoot, params = {}) {
  const name = String(params.name ?? '').trim();
  assertSlug(name, '技能');

  const description = singleLine(params.description);
  if (!description) {
    throw new Error('必须提供 --description，写清技能在什么场景下使用');
  }

  const skillsDir = path.join(repoRoot, 'content', 'skills');
  const skillDir = path.join(skillsDir, name);
  if (fs.existsSync(skillDir)) {
    throw new Error(`技能目录已存在：${toPosixPath(path.relative(repoRoot, skillDir))}`);
  }

  const title = singleLine(params.title) || name;
  const content = skillTemplate(name, title, description);
  const dryRun = params.dryRun === true;

  if (!dryRun) {
    fs.mkdirSync(skillDir, { recursive: true });
    atomicWriteFile(path.join(skillDir, 'SKILL.md'), content, 'utf8');
  }

  return {
    subcommand: 'new-skill',
    dryRun,
    name,
    file: toPosixPath(path.relative(repoRoot, path.join(skillDir, 'SKILL.md'))),
    path: path.join(skillDir, 'SKILL.md'),
    description,
    content
  };
}

function assertSlug(value, label) {
  if (!value) {
    throw new Error(`${label}名称不能为空`);
  }
  if (!SLUG_PATTERN.test(value)) {
    throw new Error(`${label}名称只能使用小写字母、数字和短横线，例如 my-${label === '规则' ? 'rule' : 'skill'}`);
  }
}

function singleLine(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function ruleTemplate(title) {
  return [
    `# ${title}`,
    '',
    '## 适用场景',
    '',
    '（待补充：说明这条规则解决什么问题、在哪些任务中生效。）',
    '',
    '## 规则',
    '',
    '- （待补充）',
    ''
  ].join('\n');
}

function skillTemplate(name, title, description) {
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    `# ${title}`,
    '',
    '## 何时使用',
    '',
    '- （待补充：用户提出什么需求、出现什么场景时使用本技能。）',
    '',
    '## 步骤',
    '',
    '1. （待补充）',
    '',
    '## 注意',
    '',
    '- （待补充：边界、禁止事项和验证方法。）',
    ''
  ].join('\n');
}

function updateIndex(indexText, fileName, title) {
  const newline = indexText.includes('\r\n') ? '\r\n' : '\n';
  const lines = indexText.split(/\r?\n/);
  const readingOrder = insertReadingOrder(lines, fileName, title);
  const dutyTable = insertDutyRow(lines, fileName);

  return {
    text: lines.join(newline),
    readingOrder,
    dutyTable
  };
}

function insertReadingOrder(lines, fileName, title) {
  const start = findHeading(lines, '## 阅读顺序');
  if (start === -1) return false;

  const end = findSectionEnd(lines, start);
  let lastRuleItem = -1;
  let lastItem = -1;

  for (let index = start + 1; index < end; index += 1) {
    if (/^\d+\.\s+/.test(lines[index])) {
      lastItem = index;
      if (/^\d+\.\s+.*`\d{2}-[a-z0-9-]+\.md`/.test(lines[index])) {
        lastRuleItem = index;
      }
    }
  }

  const insertAfter = lastRuleItem !== -1 ? lastRuleItem : lastItem;
  if (insertAfter === -1) return false;

  lines.splice(insertAfter + 1, 0, `0. \`${fileName}\`：${title}。`);
  renumberList(lines, start);
  return true;
}

function renumberList(lines, start) {
  const end = findSectionEnd(lines, start);
  let counter = 1;

  for (let index = start + 1; index < end; index += 1) {
    const match = /^\d+\.\s+(.*)$/.exec(lines[index]);
    if (match) {
      lines[index] = `${counter}. ${match[1]}`;
      counter += 1;
    }
  }
}

function insertDutyRow(lines, fileName) {
  const start = findHeading(lines, '## 文件职责');
  if (start === -1) return false;

  const end = findSectionEnd(lines, start);
  const rows = [];

  for (let index = start + 1; index < end; index += 1) {
    if (lines[index].trim().startsWith('|')) rows.push(index);
  }

  if (rows.length < 2) return false;

  const machineRow = rows.find((index) => lines[index].includes('machines/'));
  const insertAt = machineRow ?? rows[rows.length - 1] + 1;
  lines.splice(insertAt, 0, `| \`${fileName}\` | 待补充。 |`);
  return true;
}

function findHeading(lines, heading) {
  return lines.findIndex((line) => line.trim() === heading);
}

function findSectionEnd(lines, start) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) return index;
  }
  return lines.length;
}

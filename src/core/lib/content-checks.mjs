import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { toPosixPath } from './paths.mjs';

/** 必须存在且标记 builtin: true 的技能；删除或改名只能通过仓库维护。 */
export const REQUIRED_BUILTIN_SKILLS = ['aiwb'];

const RULE_FILE_PATTERN = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RULE_REFERENCE_PATTERN = /`(\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md)`/g;
const ABSOLUTE_PATH_PATTERN = /(?:^|[^A-Za-z0-9_])[A-Za-z]:[\\/]/;

/**
 * 校验 content/rules 与 content/skills 的结构和一致性。
 * @param {string} repoRoot 仓库根目录
 * @param {{overrides?: Record<string, string>}} [options] 用仓库相对路径覆盖待校验的正文
 * @returns {{ok: boolean, errors: Array<object>, warnings: Array<object>, rules: Array<object>, skills: Array<object>}} 校验结果
 */
export function lintContent(repoRoot, options = {}) {
  const errors = [];
  const warnings = [];
  const overrides = options.overrides ?? {};
  const rules = lintRules(repoRoot, errors, warnings, overrides);
  const skills = lintSkills(repoRoot, errors, warnings, overrides);

  return { ok: errors.length === 0, errors, warnings, rules, skills };
}

function lintRules(repoRoot, errors, warnings, overrides) {
  const rulesDir = path.join(repoRoot, 'content', 'rules');
  if (!fs.existsSync(rulesDir)) {
    errors.push(issue('rules', rulesDir, '缺少 content/rules 目录'));
    return [];
  }

  const fileNames = fs
    .readdirSync(rulesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();

  const indexPath = path.join(rulesDir, '00-index.md');
  const indexExists = fs.existsSync(indexPath);
  const indexText = readText(repoRoot, indexPath, overrides);
  if (!indexExists) {
    errors.push(issue('rules', indexPath, '缺少规则总索引 00-index.md'));
  }

  const rules = [];
  const prefixes = new Map();

  for (const fileName of fileNames) {
    if (fileName === '00-index.md') continue;

    const filePath = path.join(rulesDir, fileName);
    const match = RULE_FILE_PATTERN.exec(fileName);

    if (!match) {
      errors.push(
        issue('rules', filePath, '规则文件名应为“两位编号-小写短横线.md”，例如 04-content.md')
      );
    } else if (prefixes.has(match[1])) {
      errors.push(issue('rules', filePath, `编号 ${match[1]} 与 ${prefixes.get(match[1])} 重复`));
    } else {
      prefixes.set(match[1], fileName);
    }

    const text = readText(repoRoot, filePath, overrides);
    if (ABSOLUTE_PATH_PATTERN.test(text)) {
      errors.push(issue('rules', filePath, '规则正文不应包含本机盘符绝对路径'));
    }

    const indexed = indexText.includes(fileName);
    if (!indexed) {
      errors.push(issue('rules', filePath, '未在 00-index.md 的阅读顺序或文件职责中登记'));
    }

    rules.push({ file: fileName, indexed });
  }

  for (const match of indexText.matchAll(RULE_REFERENCE_PATTERN)) {
    if (!fileNames.includes(match[1])) {
      errors.push(issue('rules', indexPath, `引用了不存在的规则文件 ${match[1]}`));
    }
  }

  if (rules.length === 0) {
    warnings.push(issue('rules', rulesDir, '当前没有规则文件'));
  }

  return rules;
}

function lintSkills(repoRoot, errors, warnings, overrides) {
  const skillsDir = path.join(repoRoot, 'content', 'skills');
  if (!fs.existsSync(skillsDir)) {
    errors.push(issue('skills', skillsDir, '缺少 content/skills 目录'));
    return [];
  }

  const dirNames = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const skills = [];
  const names = new Map();

  for (const dirName of dirNames) {
    const skillDir = path.join(skillsDir, dirName);
    const filePath = path.join(skillDir, 'SKILL.md');

    if (!fs.existsSync(filePath)) {
      errors.push(issue('skills', skillDir, '技能目录缺少 SKILL.md'));
      continue;
    }

    const text = readText(repoRoot, filePath, overrides);
    const { meta } = parseFrontmatter(text);
    const name = String(meta.name ?? '').trim();
    const description = String(meta.description ?? '').trim();
    const builtin = meta.builtin === true || String(meta.builtin).toLowerCase() === 'true';

    if (!SKILL_NAME_PATTERN.test(dirName)) {
      errors.push(issue('skills', skillDir, '技能目录名应为小写短横线格式'));
    }
    if (!name) {
      errors.push(issue('skills', filePath, 'frontmatter 缺少 name'));
    } else if (name !== dirName) {
      errors.push(issue('skills', filePath, `name“${name}”与目录名“${dirName}”不一致`));
    }
    if (!description) {
      errors.push(issue('skills', filePath, 'frontmatter 缺少 description（写清触发场景）'));
    } else if (description.length < 10) {
      warnings.push(issue('skills', filePath, 'description 偏短，建议写清触发场景'));
    }
    if (ABSOLUTE_PATH_PATTERN.test(text)) {
      errors.push(issue('skills', filePath, '技能正文不应包含本机盘符绝对路径'));
    }
    if (name && names.has(name)) {
      errors.push(issue('skills', filePath, `技能 name“${name}”与 ${names.get(name)} 重复`));
    } else if (name) {
      names.set(name, dirName);
    }

    skills.push({
      name: name || dirName,
      dir: dirName,
      file: toPosixPath(path.relative(repoRoot, filePath)),
      description,
      builtin
    });
  }

  for (const required of REQUIRED_BUILTIN_SKILLS) {
    const skill = skills.find((item) => item.name === required);
    if (!skill) {
      errors.push(issue('skills', skillsDir, `缺少内置技能 ${required}；内置技能只能通过仓库维护`));
    } else if (!skill.builtin) {
      errors.push(
        issue('skills', path.join(skillsDir, required, 'SKILL.md'), `内置技能 ${required} 必须标记 builtin: true`)
      );
    }
  }

  return skills;
}

function readText(repoRoot, filePath, overrides) {
  const key = toPosixPath(path.relative(repoRoot, filePath));
  if (Object.hasOwn(overrides, key)) return overrides[key];
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function issue(scope, filePath, message) {
  return {
    scope,
    file: toPosixPath(filePath),
    message
  };
}

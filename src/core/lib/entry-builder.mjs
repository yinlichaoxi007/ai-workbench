import fs from 'node:fs';
import path from 'node:path';
import { normalizeNewlines } from './encoding.mjs';
import { atomicWriteFile, listFiles } from './fs-safe.mjs';
import { sha256 } from './hash.mjs';
import { loadMachine } from './machine.mjs';
import { toPosixPath } from './paths.mjs';
import { listSkills, renderSkillsIndex } from './skills-index.mjs';

const REFERENCE_KEYS = ['工作参考资料', '个人资料', '学习资料', '其他资料'];
const SOURCE_DIRS = ['content/rules', 'content/templates', 'content/skills'];

/**
 * 读取源文件并生成入口内容，不写入磁盘。
 * @param {string} repoRoot 仓库根目录
 * @param {{now?: Date, hostname?: string}} [options] 构建选项
 * @returns {{
 *   content: string,
 *   contentHash: string,
 *   blockHash: string,
 *   generatedAt: string,
 *   machine: object,
 *   skills: Array<object>,
 *   sources: Array<{path: string, hash: string}>,
 *   manifest: object
 * }} 构建结果
 */
export function buildEntry(repoRoot, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const machine = loadMachine(repoRoot, options.hostname);
  const skills = listSkills(repoRoot);

  if (!machine.paths['项目父级']) {
    throw new Error(
      `机器档案 ${machine.filePath} 缺少“项目父级”。请在“## 路径”一节补全后再构建。`
    );
  }

  const sourceFiles = collectSourceFiles(repoRoot, machine.filePath);
  const sources = sourceFiles.map((filePath) => ({
    path: toPosixPath(path.relative(repoRoot, filePath)),
    hash: sha256(fs.readFileSync(filePath))
  }));
  const contentHash = sha256(sources.map((source) => `${source.path}\0${source.hash}`).join('\n'));
  const generatedAt = formatLocalIso(now);

  const templateDir = path.join(repoRoot, 'content', 'templates');
  const headerTemplate = readText(path.join(templateDir, 'entry-header.md'));
  const essentialsTemplate = readText(path.join(templateDir, 'entry-essentials.md'));
  const indexTemplate = readText(path.join(templateDir, 'entry-index.md'));

  const values = {
    repoPath: repoRoot,
    machine: machine.host,
    generatedAt,
    contentHash,
    rulesIndexPath: path.join(repoRoot, 'content', 'rules', '00-index.md'),
    machinePath: machine.filePath,
    skillsDir: path.join(repoRoot, 'content', 'skills'),
    projectRoot: machine.paths['项目父级'],
    referenceDirs: renderReferenceDirs(machine.paths),
    skillsList: renderSkillsIndex(skills)
  };

  const content = [
    renderTemplate(headerTemplate, values).trim(),
    renderTemplate(essentialsTemplate, values).trim(),
    renderTemplate(indexTemplate, values).trim()
  ].join('\n\n');

  assertNoPlaceholders(content);

  const normalizedContent = `${normalizeNewlines(content).trimEnd()}\n`;
  const blockHash = sha256(normalizedContent);

  return {
    content: normalizedContent,
    contentHash,
    blockHash,
    generatedAt,
    machine,
    skills,
    sources,
    manifest: {
      version: 1,
      machine: machine.host,
      generatedAt,
      contentHash,
      blockHash,
      entryFile: 'dist/ENTRY.md',
      sources,
      skills: skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        file: skill.relativeFile
      }))
    }
  };
}

/**
 * 构建并写入 dist/ENTRY.md 与 dist/manifest.json。
 * @param {string} repoRoot 仓库根目录
 * @param {{now?: Date, hostname?: string}} [options] 构建选项
 * @returns {ReturnType<typeof buildEntry> & {entryPath: string, manifestPath: string, rebuilt: true}} 构建结果
 */
export function buildWorkbench(repoRoot, options = {}) {
  const built = buildEntry(repoRoot, options);
  return writeBuild(repoRoot, built);
}

/**
 * 确保 dist 与当前源内容一致；必要时自动重新构建。
 * @param {string} repoRoot 仓库根目录
 * @param {{now?: Date, hostname?: string}} [options] 构建选项
 * @returns {ReturnType<typeof buildEntry> & {entryPath: string, manifestPath: string, rebuilt: boolean}} 构建结果
 */
export function ensureBuild(repoRoot, options = {}) {
  const built = buildEntry(repoRoot, options);
  const paths = distPaths(repoRoot);
  const manifest = readManifest(repoRoot);

  if (!fs.existsSync(paths.entryPath) || !manifest || manifest.contentHash !== built.contentHash) {
    return writeBuild(repoRoot, built);
  }

  return {
    ...built,
    content: fs.readFileSync(paths.entryPath, 'utf8'),
    contentHash: manifest.contentHash,
    blockHash: manifest.blockHash,
    manifest,
    entryPath: paths.entryPath,
    manifestPath: paths.manifestPath,
    rebuilt: false
  };
}

/**
 * 检查 dist 是否与当前源内容一致，不写文件。
 * @param {string} repoRoot 仓库根目录
 * @param {{now?: Date, hostname?: string}} [options] 构建选项
 * @returns {{current: boolean, contentHash: string, manifestContentHash: string|null, entryExists: boolean, error: string|null}} 检查结果
 */
export function checkBuild(repoRoot, options = {}) {
  const built = buildEntry(repoRoot, options);
  const paths = distPaths(repoRoot);
  let manifest = null;
  let error = null;

  try {
    manifest = readManifest(repoRoot);
  } catch (caught) {
    error = caught.message;
  }

  return {
    current: fs.existsSync(paths.entryPath) && manifest?.contentHash === built.contentHash,
    contentHash: built.contentHash,
    manifestContentHash: manifest?.contentHash ?? null,
    entryExists: fs.existsSync(paths.entryPath),
    error
  };
}

/**
 * 读取 dist/manifest.json。
 * @param {string} repoRoot 仓库根目录
 * @returns {object|null} 清单；不存在时返回 null
 */
export function readManifest(repoRoot) {
  const { manifestPath } = distPaths(repoRoot);
  if (!fs.existsSync(manifestPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`构建清单无法解析：${manifestPath}（${error.message}）`);
  }
}

/**
 * 返回构建产物路径。
 * @param {string} repoRoot 仓库根目录
 * @returns {{entryPath: string, manifestPath: string}} 路径
 */
export function distPaths(repoRoot) {
  return {
    entryPath: path.join(repoRoot, 'dist', 'ENTRY.md'),
    manifestPath: path.join(repoRoot, 'dist', 'manifest.json')
  };
}

function writeBuild(repoRoot, built) {
  const paths = distPaths(repoRoot);
  atomicWriteFile(paths.entryPath, built.content, 'utf8');
  atomicWriteFile(paths.manifestPath, `${JSON.stringify(built.manifest, null, 2)}\n`, 'utf8');
  return { ...built, ...paths, rebuilt: true };
}

function collectSourceFiles(repoRoot, machineFilePath) {
  const files = [machineFilePath];
  const versionFile = path.join(repoRoot, 'VERSION');
  if (fs.existsSync(versionFile)) files.push(versionFile);

  for (const relativeDir of SOURCE_DIRS) {
    const absoluteDir = path.join(repoRoot, relativeDir);
    files.push(
      ...listFiles(absoluteDir, (filePath) => !path.basename(filePath).startsWith('.'))
    );
  }

  return [...new Set(files)].sort((a, b) =>
    toPosixPath(path.relative(repoRoot, a)).localeCompare(
      toPosixPath(path.relative(repoRoot, b)),
      'en'
    )
  );
}

function renderReferenceDirs(paths) {
  const lines = REFERENCE_KEYS.filter((key) => paths[key]).map((key) => `  - ${key}：${paths[key]}`);
  return lines.length > 0 ? lines.join('\n') : '  - （未在机器档案中配置）';
}

function renderTemplate(template, values) {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : match
  );
}

function assertNoPlaceholders(content) {
  const unresolved = [...content.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((match) => match[1]);
  if (unresolved.length > 0) {
    throw new Error(`入口模板存在未替换的占位符：${[...new Set(unresolved)].join(', ')}`);
  }
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`缺少模板文件：${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function formatLocalIso(date) {
  const pad = (value) => String(Math.abs(value)).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetRemainder = Math.abs(offsetMinutes) % 60;

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offsetHours)}:${pad(offsetRemainder)}`
  );
}

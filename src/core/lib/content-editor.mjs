import fs from 'node:fs';
import path from 'node:path';
import { lintContent } from './content-checks.mjs';
import { buildWorkbench } from './entry-builder.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { atomicWriteFile } from './fs-safe.mjs';
import { sha256 } from './hash.mjs';
import { acquireLock } from './lock.mjs';
import { toPosixPath } from './paths.mjs';

const KIND_LABELS = { rule: '规则', skill: '技能' };
const RULE_NAME_PATTERN = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 列出可编辑的规则与技能。
 * @param {string} repoRoot 仓库根目录
 * @returns {{rules: Array<object>, skills: Array<object>}} 内容清单
 */
export function listContent(repoRoot) {
  const rulesDir = path.join(repoRoot, 'content', 'rules');
  const skillsDir = path.join(repoRoot, 'content', 'skills');
  const indexPath = path.join(rulesDir, '00-index.md');
  const indexText = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
  const rules = [];
  const skills = [];

  if (fs.existsSync(rulesDir)) {
    for (const fileName of listNames(rulesDir, 'file')) {
      const name = fileName.replace(/\.md$/, '');
      if (!fileName.endsWith('.md') || !RULE_NAME_PATTERN.test(name)) continue;
      const filePath = path.join(rulesDir, fileName);
      const buffer = fs.readFileSync(filePath);
      const text = decodeUtf8(buffer, filePath);
      rules.push({
        kind: 'rule',
        name,
        file: toPosixPath(path.relative(repoRoot, filePath)),
        title: firstHeading(text) || name,
        fileHash: sha256(buffer),
        isIndex: name === '00-index',
        indexed: name === '00-index' ? true : indexText.includes(fileName)
      });
    }
  }

  if (fs.existsSync(skillsDir)) {
    for (const name of listNames(skillsDir, 'directory')) {
      if (!SKILL_NAME_PATTERN.test(name)) continue;
      const skillDir = path.join(skillsDir, name);
      const filePath = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(filePath)) continue;
      const buffer = fs.readFileSync(filePath);
      const text = decodeUtf8(buffer, filePath);
      const { meta } = parseFrontmatter(text);
      skills.push({
        kind: 'skill',
        name,
        file: toPosixPath(path.relative(repoRoot, filePath)),
        title: firstHeading(text) || name,
        description: String(meta.description ?? '').trim(),
        builtin: meta.builtin === true || String(meta.builtin).toLowerCase() === 'true',
        fileHash: sha256(buffer)
      });
    }
  }

  return { rules, skills };
}

/**
 * 读取单个规则或技能正文。
 * @param {string} repoRoot 仓库根目录
 * @param {{kind?: string, name?: string}} params 内容标识
 * @returns {object} 文件路径、正文与哈希
 */
export function readContent(repoRoot, params = {}) {
  const target = resolveContentFile(repoRoot, params.kind, params.name);
  const buffer = fs.readFileSync(target.filePath);
  const content = decodeUtf8(buffer, target.filePath);
  const { meta } = target.kind === 'skill' ? parseFrontmatter(content) : { meta: {} };

  return {
    kind: target.kind,
    name: target.name,
    title: firstHeading(content) || target.name,
    file: toPosixPath(path.relative(repoRoot, target.filePath)),
    content,
    fileHash: sha256(buffer),
    isIndex: target.kind === 'rule' && target.name === '00-index',
    builtin: meta.builtin === true || String(meta.builtin).toLowerCase() === 'true'
  };
}

/**
 * 校验并保存规则或技能正文；默认只预演。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{kind?: string, name?: string, content?: string, apply?: boolean, expectedFileHash?: string}} params 保存参数
 * @returns {object} 预演或写入结果
 */
export function saveContent(ctx, params = {}) {
  const target = resolveContentFile(ctx.repoRoot, params.kind, params.name);
  if (typeof params.content !== 'string' || params.content.trim() === '') {
    throw new Error('保存内容不能为空');
  }

  const originalBuffer = fs.readFileSync(target.filePath);
  const originalContent = decodeUtf8(originalBuffer, target.filePath);
  const fileHash = sha256(originalBuffer);
  const expected = normalizeHash(params.expectedFileHash);
  if (params.expectedFileHash && !expected) {
    throw new Error('expectedFileHash 必须是完整的 SHA-256 哈希');
  }
  if (params.apply === true && !expected) {
    throw new Error('保存前需要提供读取时的文件哈希（--expected-hash）');
  }
  if (expected && expected !== fileHash) {
    return blockedResult(target, fileHash, '文件在读取后已变化，未保存；请重新加载内容后再编辑');
  }

  const changed = params.content !== originalContent;
  if (!changed) {
    const lint = lintContent(ctx.repoRoot);
    return {
      ...baseResult(target, fileHash),
      status: 'unchanged',
      ok: lint.ok,
      changed: false,
      canApply: false,
      lint: publicLint(lint),
      reason: '内容与当前文件一致，没有需要保存的修改'
    };
  }

  const apply = params.apply === true;
  if (!apply) {
    const lint = lintProposed(ctx.repoRoot, target, params.content);
    return {
      ...baseResult(target, fileHash),
      status: lint.ok ? 'preview' : 'blocked',
      ok: lint.ok,
      changed: true,
      canApply: lint.ok,
      nextHash: sha256(Buffer.from(params.content, 'utf8')),
      lint: publicLint(lint),
      reason: lint.ok ? '预演完成，确认后写入并重建构建' : '内容校验未通过，修复后才能保存'
    };
  }

  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const lock = acquireLock(ctx.repoRoot, { now });

  try {
    const currentBuffer = fs.readFileSync(target.filePath);
    const currentHash = sha256(currentBuffer);
    if (currentHash !== fileHash || (expected && expected !== currentHash)) {
      return blockedResult(
        target,
        currentHash,
        '文件在预演后已变化，未保存；请重新加载内容后再编辑'
      );
    }

    const proposed = Buffer.from(params.content, 'utf8');
    const nextHash = sha256(proposed);
    const lint = lintProposed(ctx.repoRoot, target, params.content);
    if (!lint.ok) {
      return {
        ...baseResult(target, currentHash),
        status: 'blocked',
        ok: false,
        changed: true,
        canApply: false,
        nextHash,
        lint: publicLint(lint),
        reason: '内容校验未通过，未写入；修复后再保存'
      };
    }

    let build;
    try {
      atomicWriteFile(target.filePath, proposed);
      const written = fs.readFileSync(target.filePath);
      if (sha256(written) !== nextHash) {
        throw new Error('写后哈希与提交内容不一致');
      }
      const diskLint = lintContent(ctx.repoRoot);
      if (!diskLint.ok) {
        throw new Error(`写后校验未通过：${diskLint.errors.map(formatIssue).join('；')}`);
      }
      build = summarizeBuild(
        buildWorkbench(ctx.repoRoot, { now, hostname: ctx.hostname }),
        ctx.repoRoot
      );
    } catch (error) {
      restoreFile(target.filePath, originalBuffer);
      restoreBuild(ctx.repoRoot, { now, hostname: ctx.hostname });
      throw new Error(`保存内容失败，已恢复原文件：${error.message}`);
    }

    return {
      ...baseResult(target, nextHash),
      status: 'applied',
      ok: true,
      changed: true,
      canApply: false,
      previousHash: fileHash,
      lint: publicLint(lint),
      build,
      reason: '已保存内容并重建构建'
    };
  } finally {
    lock.release();
  }
}

function resolveContentFile(repoRoot, kind, name) {
  if (!Object.hasOwn(KIND_LABELS, kind)) {
    throw new Error(`内容类型必须是 rule 或 skill，收到：${kind ?? '（未指定）'}`);
  }

  const value = String(name ?? '').trim();
  if (kind === 'rule') {
    if (!RULE_NAME_PATTERN.test(value)) {
      throw new Error('规则名称应为“两位编号-小写短横线”，例如 04-storage');
    }
    const filePath = path.join(repoRoot, 'content', 'rules', `${value}.md`);
    if (!fs.existsSync(filePath)) throw new Error(`找不到规则文件：content/rules/${value}.md`);
    return { repoRoot, kind, name: value, filePath };
  }

  if (!SKILL_NAME_PATTERN.test(value)) {
    throw new Error('技能名称只能使用小写字母、数字和短横线');
  }
  const filePath = path.join(repoRoot, 'content', 'skills', value, 'SKILL.md');
  if (!fs.existsSync(filePath)) {
    throw new Error(`找不到技能文件：content/skills/${value}/SKILL.md`);
  }
  return { repoRoot, kind, name: value, filePath };
}

function lintProposed(repoRoot, target, content) {
  const file = toPosixPath(path.relative(repoRoot, target.filePath));
  return lintContent(repoRoot, { overrides: { [file]: content } });
}

function baseResult(target, fileHash) {
  return {
    subcommand: 'save',
    kind: target.kind,
    name: target.name,
    label: KIND_LABELS[target.kind],
    file: toPosixPath(path.relative(target.repoRoot, target.filePath)),
    fileHash
  };
}

function blockedResult(target, fileHash, reason) {
  return {
    ...baseResult(target, fileHash),
    status: 'blocked',
    ok: false,
    changed: false,
    canApply: false,
    reason
  };
}

function publicLint(lint) {
  return { ok: lint.ok, errors: lint.errors, warnings: lint.warnings };
}

function summarizeBuild(built, repoRoot) {
  return {
    contentHash: built.contentHash,
    blockHash: built.blockHash,
    generatedAt: built.generatedAt,
    rebuilt: built.rebuilt === true,
    entry: toPosixPath(path.relative(repoRoot, built.entryPath))
  };
}

function restoreFile(filePath, buffer) {
  try {
    atomicWriteFile(filePath, buffer);
  } catch {
    // 恢复失败时保留原始错误，原文件内容仍在内存中。
  }
}

function restoreBuild(repoRoot, options) {
  try {
    buildWorkbench(repoRoot, options);
  } catch {
    // 构建产物恢复失败不覆盖保存失败的原始错误。
  }
}

function decodeUtf8(buffer, filePath) {
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) {
    throw new Error(`文件不是有效的 UTF-8 文本：${filePath}`);
  }
  return text;
}

function normalizeHash(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = value.trim().toLowerCase().replace(/^sha256:/, '');
  return /^[0-9a-f]{64}$/.test(normalized) ? `sha256:${normalized}` : null;
}

function firstHeading(text) {
  const match = /^#\s+(.+)$/m.exec(text);
  return match ? match[1].trim() : '';
}

function listNames(directory, type) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => (type === 'file' ? entry.isFile() : entry.isDirectory()))
    .map((entry) => entry.name)
    .sort();
}

function formatIssue(issue) {
  return `${issue.file}：${issue.message}`;
}

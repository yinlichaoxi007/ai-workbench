import fs from 'node:fs';
import path from 'node:path';
import { lintContent } from '../lib/content-checks.mjs';
import { listContent, readContent, saveContent } from '../lib/content-editor.mjs';
import { buildWorkbench } from '../lib/entry-builder.mjs';
import { atomicWriteFile } from '../lib/fs-safe.mjs';
import { createRule, createSkill } from '../lib/scaffold.mjs';
import { toPosixPath } from '../lib/paths.mjs';

/**
 * 执行 content 子命令：lint、list、read、save、new-rule、new-skill。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{positionals?: string[], title?: string, description?: string, content?: string, apply?: boolean, build?: boolean, expectedFileHash?: string, dryRun?: boolean}} params 参数
 * @returns {Promise<object>} 子命令结果
 */
export async function run(ctx, params = {}) {
  const positionals = params.positionals ?? [];
  const [subcommand, target, name] = positionals;

  switch (subcommand) {
    case 'lint':
      return { subcommand: 'lint', ...lintContent(ctx.repoRoot) };
    case 'list':
      return { subcommand: 'list', ...listContent(ctx.repoRoot) };
    case 'read':
      if (!target || !name) {
        throw new Error('用法：aiwb content read <rule|skill> <名称>');
      }
      return {
        subcommand: 'read',
        ...readContent(ctx.repoRoot, { kind: target, name })
      };
    case 'save':
      if (!target || !name) {
        throw new Error(
          '用法：aiwb content save <rule|skill> <名称> --content-file <路径> [--apply] [--expected-hash <哈希>]'
        );
      }
      return saveContent(ctx, {
        kind: target,
        name,
        content: readSubmittedContent(params),
        apply: params.apply === true,
        expectedFileHash: params.expectedFileHash
      });
    case 'new-rule':
      if (!target) {
        throw new Error('用法：aiwb content new-rule <slug> [--title "标题"] [--dry-run] [--build]');
      }
      return createRuleAction(ctx, params, target);
    case 'new-skill':
      if (!target) {
        throw new Error(
          '用法：aiwb content new-skill <name> --description "触发场景" [--title "标题"] [--dry-run] [--build]'
        );
      }
      return createSkillAction(ctx, params, target);
    default:
      throw new Error('用法：aiwb content <lint|list|read|save|new-rule|new-skill> ...');
  }
}

function readSubmittedContent(params) {
  if (typeof params.content === 'string') return params.content;
  if (typeof params.contentFile === 'string') {
    return fs.readFileSync(params.contentFile, 'utf8');
  }
  throw new Error('保存内容需要 --content-file 指向完整正文，或在 GUI 编辑器中提交正文');
}

function createRuleAction(ctx, params, slug) {
  const rulesDir = path.join(ctx.repoRoot, 'content', 'rules');
  const indexPath = path.join(rulesDir, '00-index.md');
  const indexBefore = fs.existsSync(indexPath) ? fs.readFileSync(indexPath) : null;
  const result = createRule(ctx.repoRoot, {
    slug,
    title: params.title,
    dryRun: params.dryRun === true
  });
  return buildAfterCreate(ctx, params, result, () => {
    fs.rmSync(result.path, { force: true });
    if (indexBefore) atomicWriteFile(indexPath, indexBefore);
  });
}

function createSkillAction(ctx, params, name) {
  const result = createSkill(ctx.repoRoot, {
    name,
    title: params.title,
    description: params.description,
    dryRun: params.dryRun === true
  });
  return buildAfterCreate(ctx, params, result, () => {
    fs.rmSync(path.dirname(result.path), { recursive: true, force: true });
  });
}

function buildAfterCreate(ctx, params, result, rollback) {
  if (params.build !== true || result.dryRun) return result;

  try {
    return { ...result, build: summarizeBuild(ctx, buildWorkbench(ctx.repoRoot, buildOptions(ctx))) };
  } catch (error) {
    rollback();
    try {
      buildWorkbench(ctx.repoRoot, buildOptions(ctx));
    } catch {
      // 回滚构建失败不覆盖创建失败的原始错误。
    }
    throw new Error(`创建内容失败，已回滚：${error.message}`);
  }
}

function buildOptions(ctx) {
  return {
    now: ctx.now instanceof Date ? ctx.now : new Date(),
    hostname: ctx.hostname
  };
}

function summarizeBuild(ctx, built) {
  return {
    contentHash: built.contentHash,
    blockHash: built.blockHash,
    generatedAt: built.generatedAt,
    rebuilt: built.rebuilt === true,
    entry: toPosixPath(path.relative(ctx.repoRoot, built.entryPath))
  };
}

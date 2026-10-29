import { lintContent } from '../lib/content-checks.mjs';
import { createRule, createSkill } from '../lib/scaffold.mjs';

/**
 * 执行 content 子命令：lint、new-rule、new-skill。
 * @param {{repoRoot: string}} ctx 运行上下文
 * @param {{positionals?: string[], title?: string, description?: string, dryRun?: boolean}} params 参数
 * @returns {Promise<object>} 子命令结果
 */
export async function run(ctx, params = {}) {
  const [subcommand, name] = params.positionals ?? [];

  switch (subcommand) {
    case 'lint':
      return { subcommand: 'lint', ...lintContent(ctx.repoRoot) };
    case 'new-rule':
      if (!name) {
        throw new Error('用法：aiwb content new-rule <slug> [--title "标题"] [--dry-run]');
      }
      return createRule(ctx.repoRoot, {
        slug: name,
        title: params.title,
        dryRun: params.dryRun === true
      });
    case 'new-skill':
      if (!name) {
        throw new Error(
          '用法：aiwb content new-skill <name> --description "触发场景" [--title "标题"] [--dry-run]'
        );
      }
      return createSkill(ctx.repoRoot, {
        name,
        title: params.title,
        description: params.description,
        dryRun: params.dryRun === true
      });
    default:
      throw new Error('用法：aiwb content <lint|new-rule|new-skill> ...');
  }
}

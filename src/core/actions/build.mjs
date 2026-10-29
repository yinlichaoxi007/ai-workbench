import { buildWorkbench, checkBuild } from '../lib/entry-builder.mjs';

/**
 * 生成入口内容，或只检查构建产物是否过期。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{check?: boolean}} [params] 动作参数
 * @returns {Promise<object>} 构建或检查结果
 */
export async function run(ctx, params = {}) {
  const options = { now: ctx.now, hostname: ctx.hostname };

  if (params.check) {
    return { mode: 'check', ...checkBuild(ctx.repoRoot, options) };
  }

  return { mode: 'write', ...buildWorkbench(ctx.repoRoot, options) };
}

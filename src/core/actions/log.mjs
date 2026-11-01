import { readOperations } from '../lib/operation-log.mjs';
import { readState } from '../lib/state.mjs';

/**
 * 读取操作日志与部署记录。只读，不修改任何文件。
 * @param {{repoRoot: string, now?: Date}} ctx 运行上下文
 * @param {{limit?: string|number}} [params] 参数
 * @returns {Promise<object>} 操作历史
 */
export async function run(ctx, params = {}) {
  const log = readOperations(ctx.repoRoot, { limit: params.limit });
  const state = readState(ctx.repoRoot);

  return {
    subcommand: 'list',
    ...log,
    deploy: {
      lastRun: state.lastRun,
      machine: state.machine,
      targets: Object.entries(state.targets)
        .map(([tool, record]) => ({
          tool,
          entryPath: record.entryPath ?? null,
          action: record.action ?? null,
          contentHash: record.contentHash ?? null,
          blockHash: record.blockHash ?? null,
          backup: record.backup ?? null,
          deployedAt: record.deployedAt ?? null,
          manualMerge: record.manualMerge === true
        }))
        .sort(byTimeDesc('deployedAt')),
      projects: Object.entries(state.projects)
        .map(([projectPath, record]) => ({
          projectPath,
          mode: record.mode ?? null,
          file: record.file ?? null,
          action: record.action ?? null,
          blockHash: record.blockHash ?? null,
          excludeAdded: record.excludeAdded === true,
          attachedAt: record.attachedAt ?? null
        }))
        .sort(byTimeDesc('attachedAt'))
    },
    ok: log.issues.length === 0
  };
}

function byTimeDesc(key) {
  return (left, right) => String(right[key] ?? '').localeCompare(String(left[key] ?? ''));
}

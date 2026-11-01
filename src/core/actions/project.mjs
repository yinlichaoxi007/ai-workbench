import path from 'node:path';
import { acquireLock } from '../lib/lock.mjs';
import { recordOperations } from '../lib/operation-log.mjs';
import { loadMachine } from '../lib/machine.mjs';
import {
  applyProjectExclude,
  deleteProjectEntry,
  planProjectAttach,
  planProjectDetach,
  removeProjectEntry,
  restoreProjectEntry,
  scanProjects,
  writeProjectEntry
} from '../lib/projects.mjs';
import { readState, writeState } from '../lib/state.mjs';
import { formatLocalIso } from '../lib/time.mjs';

/**
 * 扫描机器档案中的项目仓库，只读。
 * @param {{repoRoot: string, hostname?: string}} ctx 运行上下文
 * @param {{root?: string}} [params] 参数
 * @returns {Promise<object>} 扫描结果
 */
export async function runScan(ctx, params = {}) {
  const machine = loadMachine(ctx.repoRoot, ctx.hostname);
  const state = readState(ctx.repoRoot);
  const scan = scanProjects({
    repoRoot: ctx.repoRoot,
    machine,
    state,
    root: params.root
  });

  return {
    subcommand: 'scan',
    machine: { host: machine.host, filePath: machine.filePath },
    root: params.root ?? null,
    ...scan
  };
}

/**
 * 预演或执行项目挂载。默认只预演，--apply 才写入。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{path?: string, positionals?: string[], mode?: string, apply?: boolean, dryRun?: boolean}} [params] 参数
 * @returns {Promise<object>} 挂载结果
 */
export async function runAttach(ctx, params = {}) {
  const projectPath = params.path ?? params.positionals?.[0];
  if (!projectPath) throw new Error('用法：aiwb attach <项目路径> [--mode auto|local|append] [--apply]');
  if (params.apply && params.dryRun) throw new Error('--apply 与 --dry-run 不能同时使用');

  const apply = params.apply === true;
  const mode = params.mode ?? 'auto';
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const machine = loadMachine(ctx.repoRoot, ctx.hostname);
  const state = readState(ctx.repoRoot);
  const plan = planProjectAttach({
    repoRoot: ctx.repoRoot,
    projectPath,
    mode,
    machine,
    state
  });

  const result = {
    subcommand: 'attach',
    dryRun: !apply,
    mode,
    machine: { host: machine.host, filePath: machine.filePath },
    project: plan,
    summary: summarizeAttach(plan),
    apply: null
  };

  if (!apply) return result;
  if (!plan.canApply) {
    result.apply = blockedApply(plan.reason);
    result.summary = summarizeAttach(plan);
    return result;
  }

  const lock = acquireLock(ctx.repoRoot, { now });
  try {
    const freshState = readState(ctx.repoRoot);
    const fresh = planProjectAttach({
      repoRoot: ctx.repoRoot,
      projectPath,
      mode,
      machine,
      state: freshState
    });
    result.project = fresh;
    if (!fresh.canApply) {
      result.apply = blockedApply(fresh.reason);
      result.summary = summarizeAttach(fresh);
      return result;
    }
    if (fresh.fingerprint !== plan.fingerprint) {
      throw new Error('项目入口在预演后发生变化，未挂载。请重新运行 attach 确认。');
    }

    let entry = { changed: false, action: 'unchanged', backup: null, backupHandle: null };
    let excludeResult = { action: fresh.exclude?.action ?? 'none', changed: false };
    try {
      if (fresh.action !== 'unchanged') {
        entry = writeProjectEntry({ repoRoot: ctx.repoRoot, plan: fresh, now });
      }
      excludeResult = applyProjectExclude(fresh.exclude);

      const nextState = readState(ctx.repoRoot);
      nextState.machine = machine.host;
      nextState.lastRun = formatLocalIso(now);
      nextState.projects[fresh.projectPath] = {
        mode: fresh.mode,
        file: fresh.file,
        action: fresh.recorded ? (fresh.storedAction ?? fresh.action) : entry.action,
        blockHash: fresh.blockHash,
        excludeAdded: fresh.exclude?.action === 'add' || Boolean(fresh.storedExcludeAdded),
        attachedAt: formatLocalIso(now)
      };
      writeState(ctx.repoRoot, nextState);

      fresh.applyStatus = attachStatus(entry.action);
      fresh.backup = entry.backup;
      fresh.excludeResult = excludeResult;
      result.apply = {
        ok: true,
        changed: entry.changed || excludeResult.changed,
        action: fresh.action,
        backup: entry.backup,
        exclude: excludeResult.action,
        failed: 0,
        blocked: 0,
        reason: null
      };
      result.summary = summarizeAttach(fresh);
      if (result.apply.changed) {
        result.log = recordOperations(ctx, [
          {
            action: 'attach',
            target: fresh.targetPath,
            result: fresh.applyStatus,
            backup: entry.backup ?? null,
            detail: { mode: fresh.mode, file: fresh.file, exclude: excludeResult.action }
          }
        ]);
      }
      return result;
    } catch (error) {
      rollbackAttach(fresh, entry);
      fresh.applyStatus = 'failed';
      fresh.error = error.message;
      result.apply = {
        ok: false,
        changed: false,
        failed: 1,
        blocked: 0,
        reason: `挂载失败，已回滚：${error.message}`
      };
      result.summary = summarizeAttach(fresh);
      result.log = recordOperations(ctx, [
        {
          action: 'attach',
          target: fresh.targetPath,
          result: 'failed',
          detail: { error: error.message }
        }
      ]);
      return result;
    }
  } finally {
    lock.release();
  }
}

/**
 * 预演或执行取消项目挂载。默认只预演，--apply 才写入。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{path?: string, positionals?: string[], apply?: boolean, dryRun?: boolean, force?: boolean}} [params] 参数
 * @returns {Promise<object>} 取消挂载结果
 */
export async function runDetach(ctx, params = {}) {
  const projectPath = params.path ?? params.positionals?.[0];
  if (!projectPath) throw new Error('用法：aiwb detach <项目路径> [--apply] [--force]');
  if (params.apply && params.dryRun) throw new Error('--apply 与 --dry-run 不能同时使用');

  const apply = params.apply === true;
  const force = params.force === true;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const machine = loadMachine(ctx.repoRoot, ctx.hostname);
  const state = readState(ctx.repoRoot);
  const plan = planProjectDetach({
    repoRoot: ctx.repoRoot,
    projectPath,
    state,
    force,
    machine
  });

  const result = {
    subcommand: 'detach',
    dryRun: !apply,
    force,
    machine: { host: machine.host, filePath: machine.filePath },
    project: plan,
    summary: summarizeDetach(plan),
    apply: null
  };

  if (!apply) return result;
  if (!plan.canApply) {
    result.apply = blockedApply(plan.reason);
    result.summary = summarizeDetach(plan);
    return result;
  }

  const lock = acquireLock(ctx.repoRoot, { now });
  try {
    const freshState = readState(ctx.repoRoot);
    const fresh = planProjectDetach({
      repoRoot: ctx.repoRoot,
      projectPath,
      state: freshState,
      force,
      machine
    });
    result.project = fresh;
    if (!fresh.canApply) {
      result.apply = blockedApply(fresh.reason);
      result.summary = summarizeDetach(fresh);
      return result;
    }
    if (fresh.fingerprint !== plan.fingerprint) {
      throw new Error('项目入口在预演后发生变化，未取消挂载。请重新运行 detach 确认。');
    }

    let entry = { changed: false, action: 'absent', backup: null, backupHandle: null };
    let excludeResult = { action: fresh.exclude?.action ?? 'none', changed: false };
    try {
      if (fresh.status === 'delete-file') {
        entry = deleteProjectEntry({ repoRoot: ctx.repoRoot, plan: fresh, now });
      } else if (fresh.status === 'remove-block') {
        entry = removeProjectEntry({ repoRoot: ctx.repoRoot, plan: fresh, now });
      }
      excludeResult = applyProjectExclude(fresh.exclude);

      const nextState = readState(ctx.repoRoot);
      const removed = removeProjectRecord(nextState, fresh.projectPath);
      if (removed || fresh.recorded) {
        nextState.machine = machine.host;
        nextState.lastRun = formatLocalIso(now);
        writeState(ctx.repoRoot, nextState);
      }

      fresh.applyStatus =
        entry.action === 'delete-file'
          ? 'deleted'
          : entry.action === 'remove-block'
            ? 'removed-block'
            : 'absent';
      fresh.backup = entry.backup;
      fresh.excludeResult = excludeResult;
      result.apply = {
        ok: true,
        changed: entry.changed || excludeResult.changed,
        action: entry.action,
        backup: entry.backup,
        exclude: excludeResult.action,
        failed: 0,
        blocked: 0,
        reason: null
      };
      result.summary = summarizeDetach(fresh);
      if (result.apply.changed) {
        result.log = recordOperations(ctx, [
          {
            action: 'detach',
            target: fresh.targetPath,
            result: fresh.applyStatus,
            backup: entry.backup ?? null,
            detail: { file: fresh.file, exclude: excludeResult.action }
          }
        ]);
      }
      return result;
    } catch (error) {
      rollbackDetach(fresh, entry, excludeResult);
      fresh.applyStatus = 'failed';
      fresh.error = error.message;
      result.apply = {
        ok: false,
        changed: false,
        failed: 1,
        blocked: 0,
        reason: `取消挂载失败，已回滚：${error.message}`
      };
      result.summary = summarizeDetach(fresh);
      result.log = recordOperations(ctx, [
        {
          action: 'detach',
          target: fresh.targetPath,
          result: 'failed',
          detail: { error: error.message }
        }
      ]);
      return result;
    }
  } finally {
    lock.release();
  }
}

function rollbackAttach(plan, entry) {
  if (entry.changed) {
    try {
      restoreProjectEntry(entry.backupHandle, plan.targetPath, entry.action !== 'create-file');
    } catch {
      // 回滚失败时保留原错误信息，备份仍在 state/project-backups。
    }
  }
  if (plan.exclude?.action === 'add') {
    try {
      applyProjectExclude({ ...plan.exclude, action: 'remove' });
    } catch {
      // exclude 回滚失败时保留原错误信息。
    }
  }
}

function rollbackDetach(plan, entry, excludeResult) {
  if (entry.changed) {
    try {
      restoreProjectEntry(entry.backupHandle, plan.targetPath, true);
    } catch {
      // 回滚失败时保留原错误信息，备份仍在 state/project-backups。
    }
  }
  if (excludeResult.changed && excludeResult.action === 'removed') {
    try {
      applyProjectExclude({ ...plan.exclude, action: 'add' });
    } catch {
      // exclude 回滚失败时保留原错误信息。
    }
  }
}

function removeProjectRecord(state, projectPath) {
  const target = comparablePath(projectPath);
  let removed = false;
  for (const key of Object.keys(state.projects ?? {})) {
    if (comparablePath(key) === target) {
      delete state.projects[key];
      removed = true;
    }
  }
  return removed;
}

function comparablePath(value) {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function blockedApply(reason) {
  return {
    ok: false,
    changed: false,
    failed: 0,
    blocked: 1,
    reason
  };
}

function attachStatus(action) {
  if (action === 'create-file') return 'created';
  if (action === 'append-block') return 'appended';
  if (action === 'update-block') return 'updated';
  return 'unchanged';
}

function summarizeAttach(plan) {
  const status =
    plan.applyStatus ?? (plan.status === 'blocked' ? 'blocked' : attachStatus(plan.action));
  return {
    created: status === 'created' ? 1 : 0,
    appended: status === 'appended' ? 1 : 0,
    updated: status === 'updated' ? 1 : 0,
    unchanged: status === 'unchanged' ? 1 : 0,
    blocked: status === 'blocked' || plan.status === 'blocked' ? 1 : 0,
    failed: status === 'failed' ? 1 : 0,
    excludeAdded:
      plan.exclude?.action === 'add' || plan.excludeResult?.action === 'added' ? 1 : 0
  };
}

function summarizeDetach(plan) {
  const status = plan.applyStatus ?? (plan.status === 'blocked' ? 'blocked' : plan.status);
  return {
    removed: status === 'remove-block' || status === 'removed-block' ? 1 : 0,
    deleted: status === 'delete-file' || status === 'deleted' ? 1 : 0,
    absent: status === 'absent' ? 1 : 0,
    blocked: status === 'blocked' ? 1 : 0,
    failed: status === 'failed' ? 1 : 0,
    excludeRemoved:
      plan.exclude?.action === 'remove' || plan.excludeResult?.action === 'removed' ? 1 : 0
  };
}

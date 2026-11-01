import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../lib/fs-safe.mjs';
import { sha256 } from '../lib/hash.mjs';
import { acquireLock } from '../lib/lock.mjs';
import { recordOperations } from '../lib/operation-log.mjs';
import {
  loadSettings,
  parseSettingsText,
  planSettingsUpdate,
  settingsBackupRoot
} from '../lib/settings.mjs';
import { formatLocalIso, formatStamp } from '../lib/time.mjs';
import { listTargetIds, loadTargets } from '../lib/target-registry.mjs';
import { toPosixPath } from '../lib/paths.mjs';
import { readState } from '../lib/state.mjs';

/**
 * 执行 settings 子命令：show、set、unset。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{positionals?: string[], changes?: Record<string, unknown>, apply?: boolean, force?: boolean, expectedFileHash?: string}} params 参数
 * @returns {Promise<object>} 子命令结果
 */
export async function run(ctx, params = {}) {
  const [subcommand = params.changes ? 'set' : 'show'] = params.positionals ?? [];

  switch (subcommand) {
    case 'show':
      return showSettings(ctx);
    case 'set':
      return updateSettings(ctx, params, 'set');
    case 'unset':
      return updateSettings(ctx, params, 'unset');
    default:
      throw new Error('用法：aiwb settings <show|set|unset> [设置项[=值] ...] [--apply]');
  }
}

function showSettings(ctx) {
  const loaded = loadSettings(ctx.repoRoot, ctx.hostname);
  let tools = [];
  let targetsError = null;

  try {
    tools = loadTargets(ctx.repoRoot, { hostname: ctx.hostname }).map((tool) => ({
      id: tool.id,
      name: tool.name,
      custom: tool.custom === true,
      enabled: tool.enabled,
      installed: tool.installed,
      configRoot: tool.configRoot,
      configRootExists: tool.configRootExists,
      entryPath: tool.entryPath,
      entryExists: tool.entryExists,
      usingFallback: tool.usingFallback,
      strategy: tool.entry.strategy,
      format: tool.entry.format,
      skillsDir: tool.skillsDir,
      skillsDirExists: tool.skillsDirExists,
      overrides: tool.overrides
    }));
  } catch (error) {
    targetsError = error.message;
  }

  return {
    subcommand: 'show',
    available: loaded.available,
    writable: loaded.writable,
    encoding: loaded.encoding,
    filePath: loaded.filePath,
    fileHash: loaded.fileHash,
    hasSection: loaded.hasSection,
    hasBlock: loaded.hasBlock,
    backupRetention: loaded.backupRetention,
    guiPort: loaded.guiPort,
    env: loaded.settings.env,
    overrides: loaded.settings.tools,
    customTools: loaded.settings.customTools,
    tools,
    targetsError,
    issues: loaded.issues,
    ok: loaded.available && loaded.writable && loaded.issues.length === 0 && !targetsError
  };
}

function updateSettings(ctx, params, subcommand) {
  const toolIds = safeToolIds(ctx.repoRoot);
  const changes = resolveChanges(params, subcommand);
  const loaded = loadSettings(ctx.repoRoot, ctx.hostname);
  const plan = planSettingsUpdate(loaded, changes, { toolIds });
  plan.issues.push(...customRemovalIssues(ctx.repoRoot, plan.changes));
  const apply = params.apply === true;
  const changed = plan.changes.some((change) => change.action !== 'unchanged');

  const base = {
    subcommand,
    dryRun: !apply,
    apply,
    filePath: loaded.filePath,
    fileHash: loaded.fileHash,
    changes: plan.changes,
    backupRetention: plan.backupRetention,
    guiPort: plan.guiPort,
    env: plan.settings.env,
    overrides: plan.settings.tools,
    customTools: plan.settings.customTools,
    issues: plan.issues,
    changed
  };

  if (!changed) {
    return {
      ...base,
      status: 'unchanged',
      ok: plan.issues.length === 0,
      reason: '设置已是目标值，没有需要写入的内容'
    };
  }

  if (!apply) {
    return {
      ...base,
      status: 'preview',
      ok: plan.issues.length === 0,
      canApply: plan.issues.length === 0,
      reason:
        plan.issues.length === 0
          ? '预演完成，加 --apply 写入机器档案'
          : '设置仍存在问题，修复后才能写入'
    };
  }

  if (plan.issues.length > 0 && params.force !== true) {
    return {
      ...base,
      status: 'blocked',
      ok: false,
      canForce: true,
      reason: '设置仍存在问题，未写入；修复后可重试，确认无误时可加 --force'
    };
  }

  const expected = normalizeHash(params.expectedFileHash);
  const loadedHash = normalizeHash(loaded.fileHash) ?? loaded.fileHash;
  if (expected && expected !== loadedHash) {
    return {
      ...base,
      status: 'blocked',
      ok: false,
      canForce: false,
      reason: '机器档案在预演后已变化，未写入；请重新查看设置后再试'
    };
  }

  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const lock = acquireLock(ctx.repoRoot, { now });

  try {
    const currentBuffer = fs.readFileSync(loaded.filePath);
    const currentHash = sha256(currentBuffer);
    if (currentHash !== loaded.fileHash) {
      return {
        ...base,
        fileHash: currentHash,
        status: 'blocked',
        ok: false,
        canForce: false,
        reason: '机器档案在预演后已变化，未写入；请重新查看设置后再试'
      };
    }

    const backup = writeSettingsBackup(ctx.repoRoot, {
      hostname: ctx.hostname,
      filePath: loaded.filePath,
      buffer: currentBuffer,
      hash: currentHash,
      changes: plan.changes,
      now
    });

    let nextHash;
    try {
      atomicWriteFile(loaded.filePath, plan.nextText, 'utf8');
      const writtenBuffer = fs.readFileSync(loaded.filePath);
      nextHash = sha256(writtenBuffer);
      if (nextHash !== sha256(Buffer.from(plan.nextText, 'utf8'))) {
        throw new Error('写后哈希与计划内容不一致');
      }

      const check = parseSettingsText(writtenBuffer.toString('utf8'));
      if (check.issues.length > 0) {
        throw new Error(`写后解析失败：${check.issues.map((issue) => issue.message).join('；')}`);
      }
    } catch (error) {
      restoreBuffer(loaded.filePath, currentBuffer);
      throw new Error(`写入机器档案失败，已恢复原文件：${error.message}`);
    }

    const appliedResult = {
      ...base,
      fileHash: nextHash,
      status: 'applied',
      ok: plan.issues.length === 0,
      backup,
      reason:
        plan.issues.length === 0
          ? '已写入机器档案'
          : '已写入机器档案，但仍有问题；请按 issues 修复'
    };
    appliedResult.log = recordOperations(ctx, [
      {
        action: `settings-${subcommand}`,
        target: loaded.filePath,
        result: 'applied',
        backup,
        detail: {
          keys: plan.changes
            .filter((change) => change.action !== 'unchanged')
            .map((change) => change.key)
        }
      }
    ]);
    return appliedResult;
  } finally {
    lock.release();
  }
}

function resolveChanges(params, subcommand) {
  if (params.changes && typeof params.changes === 'object') {
    if (subcommand === 'unset') {
      return Object.keys(params.changes).map((key) => ({ key, value: null }));
    }
    return Object.entries(params.changes).map(([key, value]) => ({ key, value }));
  }

  const positionals = (params.positionals ?? []).slice(1);
  if (positionals.length === 0) {
    throw new Error(
      subcommand === 'set'
        ? '用法：aiwb settings set <设置项=值> [更多设置项=值 ...] [--apply]'
        : '用法：aiwb settings unset <设置项> [更多设置项 ...] [--apply]'
    );
  }

  if (subcommand === 'unset') {
    return positionals.map((key) => ({ key, value: null }));
  }

  return positionals.map((item) => {
    const separator = item.indexOf('=');
    if (separator <= 0) {
      throw new Error(`设置项必须写成“键=值”：${item}`);
    }
    return { key: item.slice(0, separator), value: item.slice(separator + 1) };
  });
}

function safeToolIds(repoRoot) {
  try {
    return listTargetIds(repoRoot);
  } catch {
    return [];
  }
}

function customRemovalIssues(repoRoot, changes) {
  const removals = changes.filter(
    (change) => change.action === 'unset' && /^customTools\.[^.]+$/.test(change.key)
  );
  if (removals.length === 0) return [];

  const state = readState(repoRoot);
  return removals
    .filter((change) => state.targets[change.key.slice('customTools.'.length)])
    .map((change) => {
      const toolId = change.key.slice('customTools.'.length);
      return {
        key: change.key,
        message: `自定义工具 ${toolId} 已有部署记录（入口：${
          state.targets[toolId].entryPath
        }）；请先在部署页卸载该工具，再删除自定义工具，避免入口失去管理。`
      };
    });
}

function writeSettingsBackup(repoRoot, { hostname, filePath, buffer, hash, changes, now }) {
  const root = settingsBackupRoot(repoRoot);
  const stamp = uniqueStamp(root, formatStamp(now));
  const directory = path.join(root, stamp);
  fs.mkdirSync(directory, { recursive: true });

  const fileName = path.basename(filePath);
  const backupFile = path.join(directory, fileName);
  fs.writeFileSync(backupFile, buffer);

  const manifest = {
    host: hostname,
    fileName,
    filePath,
    originalHash: hash,
    backedUpAt: formatLocalIso(now),
    action: 'settings-update',
    changes: changes.map((change) => ({ key: change.key, action: change.action }))
  };
  atomicWriteFile(
    path.join(directory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );

  return toPosixPath(path.relative(repoRoot, directory));
}

function uniqueStamp(root, stamp) {
  let candidate = stamp;
  let index = 1;
  while (fs.existsSync(path.join(root, candidate))) {
    candidate = `${stamp}-${index}`;
    index += 1;
  }
  return candidate;
}

function restoreBuffer(filePath, buffer) {
  try {
    atomicWriteFile(filePath, buffer);
  } catch {
    // 恢复失败时保留原始错误，备份仍可用于人工恢复。
  }
}

function normalizeHash(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = value.trim().toLowerCase().replace(/^sha256:/, '');
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

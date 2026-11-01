import fs from 'node:fs';
import path from 'node:path';
import { createBackup, restoreBackup } from '../lib/backup.mjs';
import { decodeText } from '../lib/encoding.mjs';
import { sha256 } from '../lib/hash.mjs';
import { acquireLock } from '../lib/lock.mjs';
import { recordOperations } from '../lib/operation-log.mjs';
import { loadMachine } from '../lib/machine.mjs';
import { findBlock } from '../lib/merge-engine.mjs';
import { toPosixPath } from '../lib/paths.mjs';
import { DEFAULT_BACKUP_RETENTION } from '../lib/settings.mjs';
import { readState, writeState } from '../lib/state.mjs';
import { loadTargets } from '../lib/target-registry.mjs';
import { formatLocalIso } from '../lib/time.mjs';

/**
 * 执行 backup 子命令：list、create、prune、restore。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{positionals?: string[], tool?: string, keep?: string|number, apply?: boolean, force?: boolean}} params 参数
 * @returns {Promise<object>} 子命令结果
 */
export async function run(ctx, params = {}) {
  const [subcommand, toolId, stamp] = params.positionals ?? [];

  switch (subcommand) {
    case 'list':
      return listBackups(ctx, params);
    case 'create':
      return createBackups(ctx, params);
    case 'prune':
      return pruneBackups(ctx, params);
    case 'restore':
      return restoreEntry(ctx, params, { toolId, stamp });
    default:
      throw new Error('用法：aiwb backup <list|create|prune|restore> ...');
  }
}

function listBackups(ctx, params) {
  const tools = loadTargets(ctx.repoRoot, { hostname: ctx.hostname });
  const toolNames = new Map(tools.map((tool) => [tool.id, tool.name]));
  if (params.tool && !toolNames.has(params.tool)) {
    throw new Error(
      `未知目标：${params.tool}。可选：${tools.map((tool) => tool.id).join(', ')}`
    );
  }

  const backupsRoot = path.join(ctx.repoRoot, 'state', 'backups');
  const backups = [];
  const invalid = [];

  for (const toolDir of listDirectories(backupsRoot)) {
    if (params.tool && toolDir.name !== params.tool) continue;

    for (const stampDir of listDirectories(toolDir.path)) {
      const backupDir = stampDir.path;
      const relativeDir = toPosixPath(path.relative(ctx.repoRoot, backupDir));
      const loaded = readManifest(backupDir);
      if (loaded.error) {
        invalid.push({ tool: toolDir.name, stamp: stampDir.name, relativeDir, error: loaded.error });
        continue;
      }

      const { manifest } = loaded;
      const backupFile = path.join(backupDir, manifest.fileName);
      backups.push({
        tool: toolDir.name,
        toolName: toolNames.get(toolDir.name) ?? toolDir.name,
        stamp: stampDir.name,
        relativeDir,
        action: manifest.action,
        entryPath: manifest.entryPath,
        backedUpAt: manifest.backedUpAt,
        originalHash: manifest.originalHash,
        backupFile,
        backupFileExists: fs.existsSync(backupFile)
      });
    }
  }

  backups.sort((left, right) => (left.stamp < right.stamp ? 1 : left.stamp > right.stamp ? -1 : 0));

  return {
    subcommand: 'list',
    tool: params.tool ?? null,
    backups,
    invalid
  };
}

function createBackups(ctx, params) {
  const tools = loadTargets(ctx.repoRoot, { hostname: ctx.hostname });
  const selected = params.tool ? tools.filter((tool) => tool.id === params.tool) : tools;
  if (params.tool && selected.length === 0) {
    throw new Error(
      `未知目标：${params.tool}。可选：${tools.map((tool) => tool.id).join(', ')}`
    );
  }

  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const lock = acquireLock(ctx.repoRoot, { now });

  try {
    const results = selected.map((tool) => createToolBackup(ctx.repoRoot, tool, now));
    const summary = {
      created: results.filter((item) => item.status === 'created').length,
      missing: results.filter((item) => item.status === 'missing').length,
      failed: results.filter((item) => item.status === 'failed').length,
      total: results.length
    };

    const result = {
      subcommand: 'create',
      tool: params.tool ?? null,
      tools: results,
      summary,
      ok: summary.failed === 0
    };
    result.log = recordOperations(ctx, createLogEntries(results));
    return result;
  } finally {
    lock.release();
  }
}

function createLogEntries(results) {
  const entries = [];
  for (const item of results) {
    if (item.status === 'created') {
      entries.push({
        action: 'backup-create',
        tool: item.id,
        target: item.entryPath,
        result: 'created',
        backup: item.backup
      });
    } else if (item.status === 'failed') {
      entries.push({
        action: 'backup-create',
        tool: item.id,
        target: item.entryPath,
        result: 'failed',
        detail: { error: item.reason }
      });
    }
  }
  return entries;
}

function createToolBackup(repoRoot, tool, now) {
  const base = {
    id: tool.id,
    name: tool.name,
    entryPath: tool.entryPath
  };

  if (!fs.existsSync(tool.entryPath)) {
    return { ...base, status: 'missing', backup: null, reason: '入口文件不存在' };
  }

  try {
    const backup = createBackup(repoRoot, {
      toolId: tool.id,
      entryPath: tool.entryPath,
      action: 'manual',
      now
    });
    return {
      ...base,
      status: 'created',
      backup: backup.relativeDir,
      reason: null
    };
  } catch (error) {
    return { ...base, status: 'failed', backup: null, reason: error.message };
  }
}

function pruneBackups(ctx, params) {
  const tools = loadTargets(ctx.repoRoot, { hostname: ctx.hostname });
  if (params.tool && !tools.some((tool) => tool.id === params.tool)) {
    throw new Error(
      `未知目标：${params.tool}。可选：${tools.map((tool) => tool.id).join(', ')}`
    );
  }

  const { keep, source } = resolveRetention(ctx, params);
  const apply = params.apply === true;

  if (!apply) {
    return buildPruneResult(ctx, { tools, toolId: params.tool, keep, source, apply: false });
  }

  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const lock = acquireLock(ctx.repoRoot, { now });
  try {
    return buildPruneResult(ctx, { tools, toolId: params.tool, keep, source, apply: true });
  } finally {
    lock.release();
  }
}

function resolveRetention(ctx, params) {
  if (params.keep !== undefined) {
    const value = Number(params.keep);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`--keep 必须是大于 0 的整数：${params.keep}`);
    }
    return { keep: value, source: 'option' };
  }

  try {
    const machine = loadMachine(ctx.repoRoot, ctx.hostname);
    const { value, source } = machine.settings.backupRetention;
    return { keep: value, source };
  } catch {
    // 缺少机器档案时，本地备份仍按默认份数清理。
  }
  return { keep: DEFAULT_BACKUP_RETENTION, source: 'default' };
}

function buildPruneResult(ctx, { tools, toolId, keep, source, apply }) {
  const toolNames = new Map(tools.map((tool) => [tool.id, tool.name]));
  const backupsRoot = path.join(ctx.repoRoot, 'state', 'backups');
  const items = [];

  for (const toolDir of listDirectories(backupsRoot)) {
    if (toolId && toolDir.name !== toolId) continue;

    const stampDirs = listDirectories(toolDir.path);
    const toolName = toolNames.get(toolDir.name);
    if (!toolName) {
      for (const stampDir of stampDirs) {
        items.push(
          pruneBaseItem(ctx, toolDir.name, toolDir.name, stampDir, {
            status: 'skipped',
            reason: '工具未注册，未处理'
          })
        );
      }
      continue;
    }

    const valid = [];
    for (const stampDir of stampDirs) {
      const loaded = readManifest(stampDir.path);
      if (loaded.error) {
        items.push(
          pruneBaseItem(ctx, toolDir.name, toolName, stampDir, {
            status: 'skipped',
            reason: `清单不可用：${loaded.error}`
          })
        );
      } else if (loaded.manifest.tool !== toolDir.name) {
        items.push(
          pruneBaseItem(ctx, toolDir.name, toolName, stampDir, {
            status: 'skipped',
            reason: `清单工具 ${loaded.manifest.tool} 与目录不一致`
          })
        );
      } else {
        valid.push(stampDir);
      }
    }

    valid.sort((left, right) =>
      left.name < right.name ? 1 : left.name > right.name ? -1 : 0
    );

    valid.forEach((stampDir, index) => {
      if (index < keep) {
        items.push(
          pruneBaseItem(ctx, toolDir.name, toolName, stampDir, {
            status: 'keep',
            reason: `保留最近 ${keep} 份`
          })
        );
        return;
      }

      if (!apply) {
        items.push(
          pruneBaseItem(ctx, toolDir.name, toolName, stampDir, {
            status: 'delete',
            reason: '超出保留份数'
          })
        );
        return;
      }

      try {
        fs.rmSync(stampDir.path, { recursive: true, force: false });
        items.push(
          pruneBaseItem(ctx, toolDir.name, toolName, stampDir, {
            status: 'deleted',
            reason: '已删除'
          })
        );
      } catch (error) {
        items.push(
          pruneBaseItem(ctx, toolDir.name, toolName, stampDir, {
            status: 'failed',
            reason: error.message
          })
        );
      }
    });
  }

  const count = (status) => items.filter((item) => item.status === status).length;
  const deleted = count('deleted');
  const failed = count('failed');
  const planned = count('delete') + deleted + failed;
  const summary = {
    total: items.length,
    kept: count('keep'),
    delete: planned,
    deleted,
    skipped: count('skipped'),
    failed
  };

  const result = {
    subcommand: 'prune',
    tool: toolId ?? null,
    dryRun: !apply,
    keep,
    keepSource: source,
    items,
    summary,
    ok: failed === 0
  };
  if (apply) result.log = recordOperations(ctx, pruneLogEntries(items));
  return result;
}

function pruneLogEntries(items) {
  const groups = new Map();
  for (const item of items) {
    if (!['deleted', 'failed'].includes(item.status)) continue;
    const group = groups.get(item.tool) ?? { deleted: 0, failed: 0, error: null };
    if (item.status === 'deleted') group.deleted += 1;
    else {
      group.failed += 1;
      group.error ??= item.reason;
    }
    groups.set(item.tool, group);
  }

  return [...groups].map(([tool, group]) => ({
    action: 'backup-prune',
    tool,
    result: group.failed > 0 ? 'failed' : 'deleted',
    detail: {
      deleted: group.deleted,
      failed: group.failed,
      ...(group.error ? { error: group.error } : {})
    }
  }));
}

function pruneBaseItem(ctx, tool, toolName, stampDir, extra) {
  return {
    tool,
    toolName,
    stamp: stampDir.name,
    relativeDir: toPosixPath(path.relative(ctx.repoRoot, stampDir.path)),
    ...extra
  };
}

function restoreEntry(ctx, params, { toolId, stamp }) {
  if (!toolId) {
    throw new Error('用法：aiwb backup restore <工具 id> <时间戳> [--apply]');
  }

  const tools = loadTargets(ctx.repoRoot, { hostname: ctx.hostname });
  const tool = tools.find((candidate) => candidate.id === toolId);
  if (!tool) {
    throw new Error(
      `未知目标：${toolId}。可选：${tools.map((candidate) => candidate.id).join(', ')}`
    );
  }
  if (!stamp || !/^[0-9A-Za-z][0-9A-Za-z-]*$/.test(stamp)) {
    throw new Error(
      `时间戳缺失或不合法：${stamp ?? '（未指定）'}。用法：aiwb backup restore <工具 id> <时间戳> [--apply]`
    );
  }

  const backupDir = path.join(ctx.repoRoot, 'state', 'backups', tool.id, stamp);
  if (!fs.existsSync(backupDir)) {
    throw new Error(`找不到备份：${toPosixPath(path.relative(ctx.repoRoot, backupDir))}`);
  }

  const loaded = readManifest(backupDir);
  if (loaded.error) {
    throw new Error(`备份清单不可用：${loaded.error}`);
  }
  const { manifest } = loaded;

  if (manifest.tool !== tool.id) {
    throw new Error(`备份属于 ${manifest.tool}，与目标 ${tool.id} 不一致`);
  }
  if (!samePath(manifest.entryPath, tool.entryPath)) {
    throw new Error(
      `备份记录的入口 ${manifest.entryPath} 与当前目标路径 ${tool.entryPath} 不一致，请人工处理`
    );
  }

  const backupFile = path.join(backupDir, manifest.fileName);
  if (!fs.existsSync(backupFile)) {
    throw new Error(`备份文件缺失：${toPosixPath(path.relative(ctx.repoRoot, backupFile))}`);
  }

  const backupHash = sha256(fs.readFileSync(backupFile));
  if (backupHash !== manifest.originalHash) {
    throw new Error('备份文件哈希与清单不一致，备份可能已损坏，请勿使用');
  }

  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const entryPath = tool.entryPath;
  const currentExists = fs.existsSync(entryPath);
  const currentHash = currentExists ? sha256(fs.readFileSync(entryPath)) : null;
  const state = readState(ctx.repoRoot);
  const stored = state.targets[tool.id] ?? null;

  const plan = {
    subcommand: 'restore',
    tool: { id: tool.id, name: tool.name },
    stamp,
    entryPath,
    backupFile: toPosixPath(path.relative(ctx.repoRoot, backupFile)),
    backupHash,
    currentHash,
    storedHash: stored?.fileHash ?? null,
    force: params.force === true,
    canForce: false
  };

  if (currentHash === backupHash) {
    return { ...plan, dryRun: params.apply !== true, status: 'unchanged', reason: '入口已与备份内容一致' };
  }

  if (!fs.existsSync(path.dirname(entryPath))) {
    return {
      ...plan,
      dryRun: params.apply !== true,
      status: 'blocked',
      reason: `入口目录不存在：${path.dirname(entryPath)}`
    };
  }

  const matchesStored = Boolean(stored?.fileHash && currentHash === stored.fileHash);
  if (currentExists && !matchesStored && !plan.force) {
    return {
      ...plan,
      dryRun: params.apply !== true,
      status: 'blocked',
      canForce: true,
      reason: '入口在部署后被修改或缺少部署记录，未恢复；确认覆盖时加 --force'
    };
  }

  const preview = {
    ...plan,
    dryRun: params.apply !== true,
    status: 'restore',
    reason: currentExists ? '将用备份覆盖当前入口' : '将按备份重新创建入口'
  };
  if (params.apply !== true) return preview;

  const lock = acquireLock(ctx.repoRoot, { now });

  try {
    const lockedState = readState(ctx.repoRoot);
    const lockedStored = lockedState.targets[tool.id] ?? null;
    const lockedHash = fs.existsSync(entryPath) ? sha256(fs.readFileSync(entryPath)) : null;
    if (lockedHash !== plan.currentHash || (lockedStored?.fileHash ?? null) !== plan.storedHash) {
      throw new Error(
        `入口在预演后发生变化，未恢复：${entryPath}。请重新运行 backup restore 确认。`
      );
    }

    const safety = currentExists
      ? createBackup(ctx.repoRoot, {
          toolId: tool.id,
          entryPath,
          action: 'restore-safety',
          now
        })
      : null;

    try {
      restoreBackup({ existed: true, filePath: backupFile }, entryPath);
      const writtenHash = sha256(fs.readFileSync(entryPath));
      if (writtenHash !== backupHash) {
        throw new Error('写后哈希与备份不一致');
      }
    } catch (error) {
      throw new Error(
        `恢复 ${entryPath} 失败，${rollbackRestore(safety, entryPath, currentExists)}：${error.message}`
      );
    }

    recordRestored(lockedState, tool, entryPath, safety, now);
    writeState(ctx.repoRoot, lockedState);

    const restored = {
      ...preview,
      dryRun: false,
      status: 'restored',
      reason: currentExists ? '已用备份覆盖入口' : '已按备份重建入口',
      safetyBackup: safety?.relativeDir ?? null
    };
    restored.log = recordOperations(ctx, [
      {
        action: 'backup-restore',
        tool: tool.id,
        target: entryPath,
        result: 'restored',
        backup: plan.backupFile,
        detail: { safetyBackup: safety?.relativeDir ?? null }
      }
    ]);
    return restored;
  } finally {
    lock.release();
  }
}

function recordRestored(state, tool, entryPath, safety, now) {
  const decoded = decodeText(fs.readFileSync(entryPath));
  const block = decoded.text === null ? null : findBlock(decoded.text);
  if (!block || block.status !== 'present') {
    delete state.targets[tool.id];
    return;
  }

  state.targets[tool.id] = {
    entryPath,
    action: 'restored',
    blockHash: block.blockHash,
    fileHash: sha256(fs.readFileSync(entryPath)),
    contentHash: null,
    backup: safety?.relativeDir ?? null,
    deployedAt: formatLocalIso(now)
  };
}

function rollbackRestore(safety, entryPath, existedBefore) {
  try {
    if (safety) {
      restoreBackup(safety, entryPath);
      return '已恢复恢复前的版本';
    }
    if (!existedBefore) {
      fs.rmSync(entryPath, { force: true });
      return '已清理新建文件';
    }
    return '入口原本存在，请人工核对';
  } catch (error) {
    return `回滚失败，请按备份手工恢复（${error.message}）`;
  }
}

function listDirectories(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: path.join(root, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

function readManifest(backupDir) {
  const manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { error: '缺少 manifest.json' };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { error: `manifest.json 无法解析：${error.message}` };
  }

  const required = ['tool', 'entryPath', 'fileName', 'action', 'originalHash', 'backedUpAt'];
  const missing = required.filter((key) => typeof manifest[key] !== 'string' || manifest[key] === '');
  if (missing.length > 0) {
    return { error: `manifest.json 缺字段：${missing.join('、')}` };
  }
  if (path.basename(manifest.fileName) !== manifest.fileName) {
    return { error: 'manifest.json 的 fileName 不是单纯文件名' };
  }

  return { manifest };
}

function samePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

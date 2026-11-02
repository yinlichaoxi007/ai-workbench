import fs from 'node:fs';
import path from 'node:path';
import { createBackup, restoreBackup } from '../lib/backup.mjs';
import { decodeText, encodeText } from '../lib/encoding.mjs';
import { ensureBuild } from '../lib/entry-builder.mjs';
import { atomicWriteFile } from '../lib/fs-safe.mjs';
import { sha256 } from '../lib/hash.mjs';
import { acquireLock } from '../lib/lock.mjs';
import { blockContentHash, findBlock } from '../lib/merge-engine.mjs';
import { buildMergedEntry, planEntryMerge, validateMergeResult } from '../lib/merge-entry.mjs';
import { recordOperations } from '../lib/operation-log.mjs';
import { readState, writeState } from '../lib/state.mjs';
import { loadTargets } from '../lib/target-registry.mjs';
import { formatLocalIso } from '../lib/time.mjs';

/**
 * 预演或执行手工合并。默认只预演，--apply 且校验通过才写外部入口。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{
 *   tool?: string,
 *   positionals?: string[],
 *   content?: string,
 *   contentFile?: string,
 *   expectedFileHash?: string,
 *   expectedBuildHash?: string,
 *   apply?: boolean,
 *   dryRun?: boolean
 * }} [params] 动作参数
 * @returns {Promise<object>} 合并结果
 */
export async function run(ctx, params = {}) {
  if (params.apply && params.dryRun) {
    throw new Error('--apply 与 --dry-run 不能同时使用');
  }

  const apply = Boolean(params.apply);
  const toolId = params.tool ?? params.positionals?.[0] ?? null;
  const tools = loadTargets(ctx.repoRoot, { hostname: ctx.hostname });

  if (!toolId) {
    throw new Error(
      `用法：aiwb merge <工具 id> [--preview] [--apply --content-file <路径>]。可选：${tools
        .map((tool) => tool.id)
        .join(', ')}`
    );
  }

  const tool = tools.find((item) => item.id === toolId);
  if (!tool) {
    throw new Error(`未知目标：${toolId}。可选：${tools.map((item) => item.id).join(', ')}`);
  }
  assertMergable(tool);

  const content = readContent(params, apply);
  const build = ensureBuild(ctx.repoRoot, { now: ctx.now, hostname: ctx.hostname });
  const frontmatter = readFrontmatter(tool);
  const entry = readEntrySafe(tool.entryPath);
  const stored = readState(ctx.repoRoot).targets[tool.id] ?? null;
  const plan = planFor({ entry, tool, build, frontmatter, stored });
  const validation = content === null ? null : validateMergeResult({
    existingText: entry.text,
    mergedText: content,
    strategy: tool.entry.strategy,
    frontmatter
  });

  const base = buildResult({ tool, build, entry, plan, frontmatter, validation });
  if (!apply) return base;

  if (!base.canApply) {
    const code = base.issues.some((issue) => issue.code === 'version-blocked')
      ? 'version-blocked'
      : 'not-mergeable';
    return blockedResult(base, base.reason, code);
  }
  if (content === null) {
    throw new Error('写入需要 --content-file <路径>，或在 GUI 编辑器中提交合并结果');
  }

  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const lock = acquireLock(ctx.repoRoot, { now });

  try {
    const freshBuild = ensureBuild(ctx.repoRoot, { now: ctx.now, hostname: ctx.hostname });
    const expectedBuildHash = params.expectedBuildHash ?? build.contentHash;
    if (freshBuild.contentHash !== expectedBuildHash) {
      return blockedResult(
        base,
        '工作台内容在预演后发生变化，未写入。请重新加载预演并确认合并结果。',
        'stale-build'
      );
    }

    const freshTool = loadTargets(ctx.repoRoot, { hostname: ctx.hostname }).find(
      (item) => item.id === tool.id
    );
    if (!freshTool) {
      return blockedResult(base, '目标在预演后从设置中移除，未写入。', 'config-changed');
    }
    if (freshTool.versionCheck && !freshTool.versionCheck.ok) {
      return blockedResult(
        base,
        `版本核对未通过，未写入：${freshTool.versionCheck.reason}`,
        'version-blocked'
      );
    }

    const current = readEntrySafe(tool.entryPath);
    if (params.expectedFileHash !== undefined && current.hash !== params.expectedFileHash) {
      return blockedResult(
        base,
        '入口在预演后发生变化，未写入。请重新加载预演并确认合并结果。',
        'stale-entry'
      );
    }
    if (current.exists && current.text === null) {
      return blockedResult(
        base,
        '入口不是可读 UTF-8 文本，未写入。请先把入口转为 UTF-8，或从备份恢复。',
        'unsupported-encoding'
      );
    }

    const freshFrontmatter = readFrontmatter(tool);
    const freshValidation = validateMergeResult({
      existingText: current.text,
      mergedText: content,
      strategy: tool.entry.strategy,
      frontmatter: freshFrontmatter
    });
    if (!freshValidation.ok) {
      return {
        ...base,
        dryRun: false,
        applied: false,
        status: 'blocked',
        canApply: false,
        reason: '提交的合并结果未通过写前校验，未写入任何文件。',
        issues: mergeIssues(base.issues, freshValidation.issues),
        validation: freshValidation
      };
    }

    const nextText = buildMergedEntry({
      existingText: current.text,
      inner: freshValidation.inner,
      strategy: tool.entry.strategy,
      frontmatter: freshFrontmatter
    });
    const writtenBlock = findBlock(nextText);
    if (writtenBlock.status !== 'present' || writtenBlock.blockHash !== freshValidation.blockHash) {
      throw new Error('重建结果与校验结果不一致，未写入');
    }

    const buffer = encodeText(nextText, {
      encoding: current.exists ? current.encoding : 'utf-8',
      hasBom: current.exists ? current.hasBom : false
    });
    const backup = current.exists
      ? createBackup(ctx.repoRoot, {
          toolId: tool.id,
          entryPath: tool.entryPath,
          action: 'manual-merge',
          now
        })
      : null;

    try {
      atomicWriteFile(tool.entryPath, buffer);
      verifyWritten(tool.entryPath, buffer, freshValidation.blockHash);
    } catch (error) {
      let rollbackNote;
      try {
        rollback(backup, tool.entryPath, current.exists);
        rollbackNote = backup ? '已从备份恢复原文件' : '已清理新建文件';
      } catch (rollbackError) {
        rollbackNote = `回滚失败，请按备份手工恢复（${rollbackError.message}）`;
      }
      throw new Error(`写入 ${tool.entryPath} 失败，${rollbackNote}：${error.message}`);
    }

    const state = readState(ctx.repoRoot);
    state.targets[tool.id] = {
      entryPath: tool.entryPath,
      action: 'manual-merge',
      blockHash: freshValidation.blockHash,
      fileHash: sha256(buffer),
      contentHash: freshBuild.contentHash,
      manualMerge: true,
      backup: backup?.relativeDir ?? null,
      deployedAt: formatLocalIso(now)
    };
    state.machine = freshBuild.machine.host;
    state.lastRun = formatLocalIso(now);

    try {
      writeState(ctx.repoRoot, state);
    } catch (error) {
      throw new Error(
        `入口已写入，但部署记录失败：${error.message}。备份：${backup?.relativeDir ?? '无'}`
      );
    }

    const appliedResult = {
      ...base,
      dryRun: false,
      applied: true,
      status: 'written',
      canApply: true,
      reason: '合并结果已写入；块外原文保持不变。',
      warnings: [],
      entry: {
        ...base.entry,
        exists: true,
        text: nextText,
        fileHash: sha256(buffer),
        blockStatus: 'present',
        blockReason: null,
        currentBlockHash: freshValidation.blockHash,
        currentInner: freshValidation.inner,
        storedBlockHash: freshValidation.blockHash,
        modifiedSinceDeploy: false
      },
      validation: freshValidation,
      merged: {
        content: nextText,
        blockHash: freshValidation.blockHash,
        fileHash: sha256(buffer),
        backup: backup?.relativeDir ?? null
      },
      backup: backup?.relativeDir ?? null,
      state: {
        recordedTarget: tool.id,
        manualMerge: true,
        deployedAt: formatLocalIso(now)
      }
    };
    appliedResult.log = recordOperations(ctx, [
      {
        action: 'merge',
        tool: tool.id,
        target: tool.entryPath,
        result: 'written',
        backup: backup?.relativeDir ?? null,
        detail: { manualMerge: true }
      }
    ]);
    return appliedResult;
  } finally {
    lock.release();
  }
}

function assertMergable(tool) {
  if (tool.status === 'unsupported') {
    throw new Error(`目标 ${tool.name} 明确不接入，不能合并。`);
  }
  if (!tool.enabled) {
    throw new Error(`目标 ${tool.name} 尚未启用，不能合并。`);
  }
  if (!tool.installed && !tool.custom) {
    throw new Error(`目标 ${tool.name} 未安装：配置目录不存在（${tool.configRoot}）。`);
  }
}

function readContent(params, apply) {
  if (typeof params.content === 'string' && params.contentFile) {
    throw new Error('content 与 contentFile 只能提供一个');
  }
  if (typeof params.content === 'string') return params.content;
  if (params.contentFile) {
    const filePath = path.resolve(params.contentFile);
    if (!fs.existsSync(filePath)) {
      throw new Error(`合并内容文件不存在：${filePath}`);
    }
    const decoded = decodeText(fs.readFileSync(filePath));
    if (decoded.text === null) {
      throw new Error(
        `合并内容文件不是可识别文本：${filePath}（${decoded.encoding}）`
      );
    }
    return decoded.text;
  }
  if (apply) {
    throw new Error('写入需要 --content-file <路径>，或在 GUI 编辑器中提交合并结果');
  }
  return null;
}

function readFrontmatter(tool) {
  if (tool.entry.strategy !== 'separate-file') return '';
  if (tool.frontmatterTemplate) {
    if (!fs.existsSync(tool.frontmatterTemplate)) {
      throw new Error(`缺少 ${tool.name} 的 frontmatter 模板：${tool.frontmatterTemplate}`);
    }
    return fs.readFileSync(tool.frontmatterTemplate, 'utf8');
  }
  return typeof tool.frontmatter === 'string' ? tool.frontmatter : '';
}

function readEntrySafe(entryPath) {
  try {
    return readEntry(entryPath);
  } catch (error) {
    return {
      exists: true,
      hash: null,
      text: null,
      encoding: 'unreadable',
      hasBom: false,
      readError: error.message
    };
  }
}

function readEntry(entryPath) {
  if (!fs.existsSync(entryPath)) {
    return { exists: false, hash: null, text: null, encoding: 'utf-8', hasBom: false };
  }

  const buffer = fs.readFileSync(entryPath);
  const decoded = decodeText(buffer);
  return {
    exists: true,
    hash: sha256(buffer),
    text: decoded.text,
    encoding: decoded.encoding,
    hasBom: decoded.hasBom
  };
}

function planFor({ entry, tool, build, frontmatter, stored }) {
  if (tool.versionCheck && !tool.versionCheck.ok) {
    return blockedPlan({
      tool,
      build,
      stored,
      reason: `版本核对未通过：${tool.versionCheck.reason}`,
      code: 'version-blocked'
    });
  }
  if (entry.readError) {
    return blockedPlan({
      tool,
      build,
      stored,
      reason: `入口文件无法读取：${entry.readError}。先检查文件权限后再试。`,
      code: 'unreadable'
    });
  }
  if (entry.text === null && entry.exists) {
    return blockedPlan({
      tool,
      build,
      stored,
      reason: `入口不是可写文本（检测为 ${entry.encoding}）；先转为 UTF-8，或从备份恢复后再合并。`,
      code: 'unsupported-encoding'
    });
  }

  return planEntryMerge({
    existingText: entry.text,
    workbenchInner: build.content,
    storedBlockHash: stored?.blockHash ?? null,
    strategy: tool.entry.strategy,
    frontmatter
  });
}

function blockedPlan({ tool, build, stored, reason, code }) {
  return {
    exists: true,
    strategy: tool.entry.strategy,
    newline: '\n',
    blockStatus: 'unsupported',
    blockReason: reason,
    currentBlockHash: null,
    currentInner: null,
    workbenchBlockHash: blockContentHash(build.content),
    storedBlockHash: stored?.blockHash ?? null,
    modifiedSinceDeploy: false,
    suggested: null,
    suggestedInner: build.content,
    canApply: false,
    reason,
    warnings: [],
    issues: [{ code, message: reason }]
  };
}

function buildResult({ tool, build, entry, plan, frontmatter, validation }) {
  const issues = mergeIssues(plan.issues, validation?.issues ?? []);
  const validationOk = validation === null || validation.ok;
  const canApply = plan.canApply && validationOk;
  const reason =
    plan.issues.length > 0
      ? plan.reason
      : validation && !validation.ok
        ? '提交的合并结果未通过校验，未写入任何文件。'
        : plan.reason;

  return {
    tool: {
      id: tool.id,
      name: tool.name,
      status: tool.status,
      enabled: tool.enabled,
      installed: tool.installed,
      strategy: tool.entry.strategy,
      entryPath: tool.entryPath,
      usingFallback: tool.usingFallback,
      version: tool.version ?? null,
      detectedVersion: tool.detectedVersion ?? null,
      versionCheck: tool.versionCheck ?? null
    },
    dryRun: true,
    applied: false,
    status: canApply ? 'ready' : 'blocked',
    canApply,
    reason,
    issues,
    warnings: plan.warnings,
    entry: {
      path: tool.entryPath,
      exists: entry.exists,
      text: entry.text,
      encoding: entry.encoding,
      hasBom: entry.hasBom,
      fileHash: entry.hash,
      newline: plan.newline,
      blockStatus: plan.blockStatus,
      blockReason: plan.blockReason,
      currentBlockHash: plan.currentBlockHash,
      currentInner: plan.currentInner,
      storedBlockHash: plan.storedBlockHash,
      modifiedSinceDeploy: plan.modifiedSinceDeploy
    },
    workbench: {
      content: build.content,
      contentHash: build.contentHash,
      blockHash: build.blockHash,
      generatedAt: build.generatedAt
    },
    frontmatter: tool.entry.strategy === 'separate-file' ? frontmatter : null,
    suggested: plan.suggested,
    suggestedInner: plan.suggestedInner,
    validation,
    expected: {
      fileHash: entry.hash,
      buildHash: build.contentHash
    }
  };
}

function blockedResult(result, reason, code) {
  return {
    ...result,
    dryRun: false,
    applied: false,
    status: 'blocked',
    canApply: false,
    reason,
    issues: mergeIssues(result.issues, [{ code, message: reason }])
  };
}

function mergeIssues(...groups) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const issue of group ?? []) {
      const key = `${issue.code}\0${issue.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(issue);
    }
  }
  return merged;
}

function verifyWritten(entryPath, expectedBuffer, expectedBlockHash) {
  const written = fs.readFileSync(entryPath);
  if (sha256(written) !== sha256(expectedBuffer)) {
    throw new Error('写后字节校验不一致');
  }

  const decoded = decodeText(written);
  if (decoded.text === null) {
    throw new Error(`写后文件无法解码为文本（检测为 ${decoded.encoding}）`);
  }

  const found = findBlock(decoded.text);
  if (found.status !== 'present') {
    throw new Error(`写后未找到完整工作台块（${found.status}）`);
  }
  if (found.blockHash !== expectedBlockHash) {
    throw new Error('写后块哈希与计划不一致');
  }
}

function rollback(backup, entryPath, existedBefore) {
  if (backup) {
    restoreBackup(backup, entryPath);
    return;
  }
  if (!existedBefore) {
    fs.rmSync(entryPath, { force: true });
  }
}

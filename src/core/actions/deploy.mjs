import fs from 'node:fs';
import { applyTargetPlan, isWritableAction } from '../lib/deploy-writer.mjs';
import { decodeText } from '../lib/encoding.mjs';
import { ensureBuild } from '../lib/entry-builder.mjs';
import { applyGlobalWorkbench, planGlobalWorkbench } from '../lib/global-workbench.mjs';
import { sha256 } from '../lib/hash.mjs';
import { acquireLock } from '../lib/lock.mjs';
import { planBlockMerge, planSeparateFile } from '../lib/merge-engine.mjs';
import { recordOperations } from '../lib/operation-log.mjs';
import { resolvePath } from '../lib/paths.mjs';
import { applySkillJunctions, planSkillJunctions } from '../lib/skills-junction.mjs';
import { readState, writeState } from '../lib/state.mjs';
import { loadTargets } from '../lib/target-registry.mjs';
import { formatLocalIso } from '../lib/time.mjs';

/**
 * 预演或执行入口部署。默认只预演，--apply 才写外部文件。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{tool?: string, apply?: boolean, dryRun?: boolean}} [params] 动作参数
 * @returns {Promise<object>} 部署结果
 */
export async function run(ctx, params = {}) {
  if (params.apply && params.dryRun) {
    throw new Error('--apply 与 --dry-run 不能同时使用');
  }

  const apply = Boolean(params.apply);
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const build = ensureBuild(ctx.repoRoot, { now: ctx.now, hostname: ctx.hostname });
  const state = readState(ctx.repoRoot);
  const allTools = loadTargets(ctx.repoRoot, { hostname: ctx.hostname });
  const selected = params.tool ? allTools.filter((tool) => tool.id === params.tool) : allTools;

  if (params.tool && selected.length === 0) {
    throw new Error(
      `未知目标：${params.tool}。可选：${allTools.map((tool) => tool.id).join(', ')}`
    );
  }

  const globalPlan = params.tool
    ? null
    : planGlobalWorkbench(
        ctx.repoRoot,
        resolvePath(build.machine.paths['全局工作台'])
      );
  const targets = selected.map((tool) =>
    planTarget({ tool, build, stored: state.targets[tool.id] ?? null })
  );
  const skillsPlan = planSkillJunctions(ctx.repoRoot, selected);

  const result = {
    dryRun: !apply,
    applied: false,
    machine: { host: build.machine.host, filePath: build.machine.filePath },
    build: {
      contentHash: build.contentHash,
      blockHash: build.blockHash,
      generatedAt: build.generatedAt,
      rebuilt: build.rebuilt,
      entryPath: build.entryPath
    },
    state: {
      lastRun: state.lastRun,
      recordedTargets: Object.keys(state.targets).length
    },
    global: globalPlan,
    skills: skillsPlan,
    targets,
    summary: summarize(targets),
    apply: null
  };

  if (!apply) return result;

  const lock = acquireLock(ctx.repoRoot, { now });

  try {
    let globalToApply = globalPlan;
    if (globalPlan) {
      globalToApply = planGlobalWorkbench(
        ctx.repoRoot,
        resolvePath(build.machine.paths['全局工作台'])
      );
      result.global = globalToApply;
    }

    const skillsToApply = planSkillJunctions(ctx.repoRoot, selected);
    result.skills = skillsToApply;

    if (globalToApply && !globalToApply.ok) {
      result.skills = abortSkills(skillsToApply);
      result.apply = {
        ok: false,
        written: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
        failure: null,
        reason: `全局工作台存在 ${globalToApply.conflicts} 处冲突，未写入任何文件。`
      };
      result.log = recordOperations(ctx, [
        {
          action: 'deploy',
          target: globalToApply.linkPath ?? globalToApply.globalRoot,
          result: 'failed',
          detail: { error: result.apply.reason }
        }
      ]);
      return result;
    }

    result.global = globalToApply ? applyGlobalWorkbench(globalToApply) : null;

    let failure = null;
    for (const target of targets) {
      if (failure) {
        target.applyStatus = 'aborted';
        continue;
      }

      if (isWritableAction(target.action)) {
        try {
          const written = applyTargetPlan({
            repoRoot: ctx.repoRoot,
            target,
            plan: target,
            now
          });
          recordTarget(state, target, written, build.contentHash, now);
          target.applyStatus = 'written';
          target.backup = written.backup;
        } catch (error) {
          failure = { id: target.id, name: target.name, entryPath: target.entryPath, error: error.message };
          target.applyStatus = 'failed';
        }
        continue;
      }

      if (target.action === 'unchanged') {
        recordTarget(state, target, {
          action: 'unchanged',
          blockHash: target.blockHash,
          fileHash: target.fileHash ?? null,
          backup: null
        }, build.contentHash, now);
        target.applyStatus = 'unchanged';
        continue;
      }

      target.applyStatus = 'skipped';
    }

    state.machine = build.machine.host;
    state.lastRun = formatLocalIso(now);
    writeState(ctx.repoRoot, state);

    result.skills = failure ? abortSkills(skillsToApply) : applySkillJunctions(skillsToApply);
    const skillsFailure = result.skills.summary.failed;

    const versionBlocked = targets.filter(
      (target) => target.action === 'version-blocked'
    ).length;
    result.apply = {
      ok: !failure && skillsFailure === 0,
      written: targets.filter((target) => target.applyStatus === 'written').length,
      unchanged: targets.filter((target) => target.applyStatus === 'unchanged').length,
      blocked: versionBlocked,
      skipped: targets.filter((target) => ['skipped', 'aborted'].includes(target.applyStatus))
        .length,
      failed: failure ? 1 : 0,
      failure,
      reason: failure
        ? `写入 ${failure.name} 失败，已停止后续目标；已成功的写入与状态记录保留。`
        : skillsFailure > 0
          ? `入口已完成；技能 junction 有 ${skillsFailure} 处写入失败。`
          : versionBlocked > 0
            ? `${versionBlocked} 个目标因版本核对未写入；其余目标已完成。`
            : null
    };
    result.applied = result.apply.ok;
    result.summary = summarize(targets);
    result.log = recordOperations(
      ctx,
      deployLogEntries({ targets, global: result.global, skills: result.skills, failure })
    );

    return result;
  } finally {
    lock.release();
  }
}

function deployLogEntries({ targets, global, skills, failure }) {
  const entries = [];

  for (const target of targets) {
    if (target.applyStatus === 'written') {
      entries.push({
        action: 'deploy',
        tool: target.id,
        target: target.entryPath,
        result: 'written',
        backup: target.backup ?? null
      });
    } else if (target.applyStatus === 'failed') {
      entries.push({
        action: 'deploy',
        tool: target.id,
        target: target.entryPath,
        result: 'failed',
        detail: { error: failure?.id === target.id ? failure.error : '写入失败' }
      });
    }
  }

  const globalChanged =
    global &&
    (global.link?.action === 'create-junction' ||
      (global.dirs ?? []).some((dir) => dir.action === 'create-directory'));
  if (globalChanged) {
    entries.push({
      action: 'deploy-global',
      target: global.link?.path ?? global.globalRoot,
      result: 'written'
    });
  }

  const links = (skills?.tools ?? []).flatMap((tool) => tool.links ?? []);
  const created = links.filter((link) => link.applyStatus === 'created').length;
  const failed = skills?.summary?.failed ?? 0;
  if (created > 0) {
    entries.push({
      action: 'deploy-skills',
      target: '技能 junction',
      result: 'written',
      detail: { created }
    });
  }
  if (failed > 0) {
    entries.push({
      action: 'deploy-skills',
      target: '技能 junction',
      result: 'failed',
      detail: { failed }
    });
  }

  return entries;
}

function abortSkills(plan) {
  return {
    ...plan,
    applied: false,
    aborted: true,
    tools: plan.tools.map((tool) => {
      const wouldApply = !['no-skills', 'conflict'].includes(tool.action) && !tool.action.startsWith('skip-');
      return {
        ...tool,
        applyStatus: wouldApply ? 'aborted' : 'skipped',
        links: tool.links.map((link) => ({ ...link, applyStatus: wouldApply ? 'aborted' : 'skipped' }))
      };
    })
  };
}

function recordTarget(state, target, written, contentHash, now) {
  state.targets[target.id] = {
    entryPath: target.entryPath,
    action: written.action,
    blockHash: written.blockHash,
    fileHash: written.fileHash,
    contentHash,
    backup: written.backup,
    deployedAt: formatLocalIso(now)
  };
}

function planTarget({ tool, build, stored }) {
  const base = {
    id: tool.id,
    name: tool.name,
    status: tool.status,
    custom: tool.custom === true,
    enabled: tool.enabled,
    installed: tool.installed,
    version: tool.version,
    detectedVersion: tool.detectedVersion,
    versionDetail: tool.versionDetail,
    versionSource: tool.versionSource,
    versionCheck: tool.versionCheck,
    configRoot: tool.configRoot,
    configRootExists: tool.configRootExists,
    entryPath: tool.entryPath,
    entryPrimaryPath: tool.entryPrimaryPath,
    usingFallback: tool.usingFallback,
    strategy: tool.entry.strategy,
    skillsDir: tool.skillsDir,
    skillsDirExists: tool.skillsDirExists,
    contentHash: build.contentHash,
    deployedContentHash: stored?.contentHash ?? null
  };

  if (tool.status === 'unsupported') {
    return { ...base, exists: false, fileHash: null, action: 'skip-unsupported', reason: '该目标明确不接入' };
  }

  if (!tool.enabled) {
    return {
      ...base,
      exists: false,
      fileHash: null,
      action: 'skip-disabled',
      reason: tool.custom ? '自定义工具已停用' : '预留目标，尚未启用'
    };
  }

  if (!tool.installed && !tool.custom) {
    return {
      ...base,
      exists: false,
      fileHash: null,
      action: 'skip-not-installed',
      reason: `配置目录不存在：${tool.configRoot}`
    };
  }

  if (!tool.versionCheck.ok) {
    return {
      ...base,
      exists: fs.existsSync(tool.entryPath),
      fileHash: null,
      action: 'version-blocked',
      reason: tool.versionCheck.reason
    };
  }

  let existingText = null;
  let encoding = null;
  let hasBom = false;
  let fileHash = null;

  try {
    if (fs.existsSync(tool.entryPath)) {
      const buffer = fs.readFileSync(tool.entryPath);
      fileHash = sha256(buffer);
      const decoded = decodeText(buffer);
      encoding = decoded.encoding;
      hasBom = decoded.hasBom;
      if (decoded.text === null) {
        return {
          ...base,
          exists: true,
          encoding,
          hasBom,
          fileHash,
          action: 'manual',
          reason: `入口文件不是 UTF-8（检测为 ${decoded.encoding}），需人工合并`
        };
      }
      existingText = decoded.text;
    }
  } catch (error) {
    return {
      ...base,
      exists: true,
      fileHash: null,
      action: 'manual',
      reason: `入口文件无法读取：${error.message}`
    };
  }

  const contentUnchanged = Boolean(stored?.contentHash && stored.contentHash === build.contentHash);
  const exists = existingText !== null;

  if (tool.entry.strategy === 'separate-file') {
    const frontmatter = readFrontmatter(tool);
    const plan = planSeparateFile({
      existingText,
      newInner: build.content,
      storedBlockHash: stored?.blockHash ?? null,
      contentUnchanged,
      frontmatter
    });
    return { ...base, exists, encoding, hasBom, fileHash, ...plan };
  }

  const plan = planBlockMerge({
    existingText,
    newInner: build.content,
    storedBlockHash: stored?.blockHash ?? null,
    contentUnchanged
  });
  return { ...base, exists, encoding, hasBom, fileHash, ...plan };
}

function readFrontmatter(tool) {
  if (tool.frontmatterTemplate) {
    if (!fs.existsSync(tool.frontmatterTemplate)) {
      throw new Error(`缺少 ${tool.name} 的 frontmatter 模板：${tool.frontmatterTemplate}`);
    }
    return fs.readFileSync(tool.frontmatterTemplate, 'utf8');
  }
  return typeof tool.frontmatter === 'string' ? tool.frontmatter : '';
}

function summarize(targets) {
  const summary = {
    create: 0,
    append: 0,
    update: 0,
    unchanged: 0,
    manual: 0,
    versionBlocked: 0,
    skipped: 0,
    total: targets.length
  };

  const actionMap = {
    'create-file': 'create',
    'append-block': 'append',
    'update-block': 'update',
    unchanged: 'unchanged',
    manual: 'manual',
    'version-blocked': 'versionBlocked',
    'skip-not-installed': 'skipped',
    'skip-unsupported': 'skipped',
    'skip-disabled': 'skipped'
  };

  for (const target of targets) {
    const key = actionMap[target.action];
    if (key) summary[key] += 1;
  }
  return summary;
}

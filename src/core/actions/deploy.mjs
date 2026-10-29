import fs from 'node:fs';
import { decodeText } from '../lib/encoding.mjs';
import { ensureBuild } from '../lib/entry-builder.mjs';
import { planBlockMerge, planSeparateFile } from '../lib/merge-engine.mjs';
import { readState } from '../lib/state.mjs';
import { loadTargets } from '../lib/target-registry.mjs';

/**
 * 预演入口部署。P0/P1 阶段只规划，不写外部文件。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{tool?: string, apply?: boolean}} [params] 动作参数
 * @returns {Promise<object>} 部署预演结果
 */
export async function run(ctx, params = {}) {
  if (params.apply) {
    throw new Error('deploy --apply 尚未实现（P1 后续阶段）。当前只支持部署预演，不写外部文件。');
  }

  const build = ensureBuild(ctx.repoRoot, { now: ctx.now, hostname: ctx.hostname });
  const state = readState(ctx.repoRoot);
  const allTools = loadTargets(ctx.repoRoot);
  const selected = params.tool ? allTools.filter((tool) => tool.id === params.tool) : allTools;

  if (params.tool && selected.length === 0) {
    throw new Error(
      `未知目标：${params.tool}。可选：${allTools.map((tool) => tool.id).join(', ')}`
    );
  }

  const targets = selected.map((tool) =>
    planTarget({ tool, build, stored: state.targets[tool.id] ?? null })
  );

  return {
    dryRun: true,
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
    targets,
    summary: summarize(targets)
  };
}

function planTarget({ tool, build, stored }) {
  const base = {
    id: tool.id,
    name: tool.name,
    status: tool.status,
    enabled: tool.enabled,
    installed: tool.installed,
    configRoot: tool.configRoot,
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
    return { ...base, exists: false, action: 'skip-unsupported', reason: '该目标明确不接入' };
  }

  if (!tool.enabled) {
    return {
      ...base,
      exists: false,
      action: 'skip-disabled',
      reason: '预留目标，尚未启用'
    };
  }

  if (!tool.installed) {
    return {
      ...base,
      exists: false,
      action: 'skip-not-installed',
      reason: `配置目录不存在：${tool.configRoot}`
    };
  }

  let existingText = null;
  let encoding = null;
  let hasBom = false;

  try {
    if (fs.existsSync(tool.entryPath)) {
      const decoded = decodeText(fs.readFileSync(tool.entryPath));
      encoding = decoded.encoding;
      hasBom = decoded.hasBom;
      if (decoded.text === null) {
        return {
          ...base,
          exists: true,
          encoding,
          hasBom,
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
    return { ...base, exists, encoding, hasBom, ...plan };
  }

  const plan = planBlockMerge({
    existingText,
    newInner: build.content,
    storedBlockHash: stored?.blockHash ?? null,
    contentUnchanged
  });
  return { ...base, exists, encoding, hasBom, ...plan };
}

function readFrontmatter(tool) {
  if (!tool.frontmatterTemplate) return '';
  if (!fs.existsSync(tool.frontmatterTemplate)) {
    throw new Error(`缺少 ${tool.name} 的 frontmatter 模板：${tool.frontmatterTemplate}`);
  }
  return fs.readFileSync(tool.frontmatterTemplate, 'utf8');
}

function summarize(targets) {
  const summary = {
    create: 0,
    append: 0,
    update: 0,
    unchanged: 0,
    manual: 0,
    skipped: 0,
    total: targets.length
  };

  const actionMap = {
    'create-file': 'create',
    'append-block': 'append',
    'update-block': 'update',
    unchanged: 'unchanged',
    manual: 'manual',
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

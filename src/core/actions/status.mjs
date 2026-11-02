import fs from 'node:fs';
import { decodeText } from '../lib/encoding.mjs';
import { readManifest } from '../lib/entry-builder.mjs';
import { planGlobalWorkbench } from '../lib/global-workbench.mjs';
import { loadMachine } from '../lib/machine.mjs';
import { findBlock } from '../lib/merge-engine.mjs';
import { resolvePath } from '../lib/paths.mjs';
import { readState } from '../lib/state.mjs';
import { loadTargets } from '../lib/target-registry.mjs';

/**
 * 对比部署状态、入口文件与当前构建清单。
 * @param {{repoRoot: string, hostname?: string}} ctx 运行上下文
 * @returns {Promise<object>} 状态矩阵
 */
export async function run(ctx) {
  const machine = loadMachine(ctx.repoRoot, ctx.hostname);
  const state = readState(ctx.repoRoot);
  const tools = loadTargets(ctx.repoRoot, { hostname: ctx.hostname });

  let manifest = null;
  let buildError = null;
  try {
    manifest = readManifest(ctx.repoRoot);
  } catch (error) {
    buildError = error.message;
  }

  const targets = tools.map((tool) => statusForTool(tool, state, manifest, buildError));

  return {
    machine: { host: machine.host, filePath: machine.filePath },
    state: {
      lastRun: state.lastRun,
      recordedTargets: Object.keys(state.targets).length,
      recordedProjects: Object.keys(state.projects).length
    },
    build: {
      contentHash: manifest?.contentHash ?? null,
      generatedAt: manifest?.generatedAt ?? null,
      error: buildError
    },
    global: statusForGlobal(ctx.repoRoot, machine),
    targets,
    summary: summarize(targets)
  };
}

function statusForGlobal(repoRoot, machine) {
  const configuredPath = machine.paths['全局工作台'];
  if (!configuredPath) {
    return {
      configured: false,
      state: 'unconfigured',
      label: '未配置',
      globalRoot: null,
      linkPath: null,
      reason: '机器档案缺少“全局工作台”'
    };
  }

  const plan = planGlobalWorkbench(repoRoot, resolvePath(configuredPath));
  const base = {
    configured: true,
    globalRoot: plan.globalRoot,
    sourceDir: plan.sourceDir,
    linkPath: plan.linkPath,
    conflicts: plan.conflicts
  };

  if (plan.dirs.some((dir) => dir.action === 'conflict') || plan.link.action === 'conflict') {
    const conflicts = [...plan.dirs, plan.link]
      .filter((entry) => entry.action === 'conflict')
      .map((entry) => `${entry.name}：${entry.reason}`);
    return { ...base, state: 'conflict', label: '冲突', reason: conflicts.join('；') };
  }

  if (plan.link.action === 'create-junction') {
    return { ...base, state: 'not-installed', label: '未安装', reason: '脚本 junction 不存在' };
  }

  const pendingDirs = plan.dirs
    .filter((dir) => dir.action === 'create-directory')
    .map((dir) => dir.name);
  if (pendingDirs.length > 0) {
    return {
      ...base,
      state: 'not-installed',
      label: '未安装',
      reason: `缺目录：${pendingDirs.join('、')}`
    };
  }

  return { ...base, state: 'ok', label: '正常', reason: '目录与脚本 junction 就位' };
}

function statusForTool(tool, state, manifest, buildError) {
  const stored = state.targets[tool.id] ?? null;
  const base = {
    id: tool.id,
    name: tool.name,
    custom: tool.custom === true,
    enabled: tool.enabled,
    installed: tool.installed,
    entryPath: tool.entryPath,
    version: tool.version ?? null,
    detectedVersion: tool.detectedVersion ?? null,
    versionCheck: tool.versionCheck ?? null,
    recorded: Boolean(stored),
    deployedContentHash: stored?.contentHash ?? null
  };

  if (!tool.enabled) return { ...base, state: 'disabled', label: '预留未启用' };
  if (!tool.installed && !tool.custom) return { ...base, state: 'not-installed', label: '未安装' };
  if (tool.versionCheck && !tool.versionCheck.ok) {
    return { ...base, state: 'version-blocked', label: versionLabel(tool.versionCheck) };
  }
  if (!fs.existsSync(tool.entryPath)) {
    return stored
      ? { ...base, state: 'missing', label: '入口缺失' }
      : { ...base, state: 'not-deployed', label: '未部署' };
  }

  let text;
  try {
    const decoded = decodeText(fs.readFileSync(tool.entryPath));
    if (decoded.text === null) {
      return { ...base, state: 'unsupported-encoding', label: '编码不支持' };
    }
    text = decoded.text;
  } catch (error) {
    return { ...base, state: 'unreadable', label: `无法读取：${error.message}` };
  }

  const block = findBlock(text);
  if (block.status !== 'present') {
    return stored
      ? { ...base, state: 'missing-block', label: '工作台块缺失' }
      : { ...base, state: 'unmanaged', label: '已有文件但未部署' };
  }

  if (!stored) {
    return { ...base, state: 'unmanaged', label: '有工作台块但无状态' };
  }

  if (block.blockHash !== stored.blockHash) {
    return { ...base, state: 'drift', label: '漂移/手改' };
  }

  if (buildError) {
    return { ...base, state: 'build-error', label: '构建清单异常' };
  }

  if (manifest?.contentHash && stored.contentHash !== manifest.contentHash) {
    return { ...base, state: 'stale', label: '待更新' };
  }

  return { ...base, state: 'ok', label: '正常' };
}

function versionLabel(check) {
  if (check.status === 'mismatch') return '版本不符';
  if (check.status === 'unknown') return '版本未知';
  return '版本要求无效';
}

function summarize(targets) {
  const summary = {
    ok: 0,
    stale: 0,
    drift: 0,
    missing: 0,
    notDeployed: 0,
    notInstalled: 0,
    disabled: 0,
    versionBlocked: 0,
    manual: 0
  };

  for (const target of targets) {
    switch (target.state) {
      case 'ok':
        summary.ok += 1;
        break;
      case 'stale':
        summary.stale += 1;
        break;
      case 'drift':
        summary.drift += 1;
        break;
      case 'missing':
      case 'missing-block':
        summary.missing += 1;
        break;
      case 'not-deployed':
      case 'unmanaged':
        summary.notDeployed += 1;
        break;
      case 'not-installed':
        summary.notInstalled += 1;
        break;
      case 'disabled':
        summary.disabled += 1;
        break;
      case 'version-blocked':
        summary.versionBlocked += 1;
        break;
      default:
        summary.manual += 1;
        break;
    }
  }
  return summary;
}

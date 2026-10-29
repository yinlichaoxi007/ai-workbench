import fs from 'node:fs';
import { decodeText } from '../lib/encoding.mjs';
import { readManifest } from '../lib/entry-builder.mjs';
import { loadMachine } from '../lib/machine.mjs';
import { findBlock } from '../lib/merge-engine.mjs';
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
  const tools = loadTargets(ctx.repoRoot);

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
    targets,
    summary: summarize(targets)
  };
}

function statusForTool(tool, state, manifest, buildError) {
  const stored = state.targets[tool.id] ?? null;
  const base = {
    id: tool.id,
    name: tool.name,
    enabled: tool.enabled,
    installed: tool.installed,
    entryPath: tool.entryPath,
    recorded: Boolean(stored),
    deployedContentHash: stored?.contentHash ?? null
  };

  if (!tool.enabled) return { ...base, state: 'disabled', label: '预留未启用' };
  if (!tool.installed) return { ...base, state: 'not-installed', label: '未安装' };
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

function summarize(targets) {
  const summary = {
    ok: 0,
    stale: 0,
    drift: 0,
    missing: 0,
    notDeployed: 0,
    notInstalled: 0,
    disabled: 0,
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
      default:
        summary.manual += 1;
        break;
    }
  }
  return summary;
}

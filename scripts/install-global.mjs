#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyGlobalWorkbench, planGlobalWorkbench } from '../src/core/lib/global-workbench.mjs';
import { loadMachine } from '../src/core/lib/machine.mjs';
import { resolvePath } from '../src/core/lib/paths.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = [
  '用法：node scripts/install-global.mjs [--apply|--dry-run] [--json]',
  '',
  '按机器档案的“全局工作台”创建 todo/、scripts/、notes/、_tmp/，',
  '并把 content/scripts/ 以 junction 安装为 <全局工作台>/scripts/ai-workbench。',
  '默认只预演；--apply 才写入。存在冲突时不写入任何内容。'
].join('\n');

let options;
try {
  options = parseOptions(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  console.error(USAGE);
  process.exit(1);
}

if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

try {
  const machine = loadMachine(repoRoot);
  const globalRoot = resolvePath(machine.paths['全局工作台'] ?? '');

  if (!globalRoot) {
    throw new Error(
      `机器档案 ${machine.filePath} 缺少“全局工作台”。请在“## 路径”一节补全后再运行。`
    );
  }

  let plan = planGlobalWorkbench(repoRoot, globalRoot);
  let applied = false;

  if (options.apply && plan.ok) {
    plan = applyGlobalWorkbench(plan);
    applied = true;
  }

  const result = {
    dryRun: !options.apply,
    applied,
    machine: { host: machine.host, filePath: machine.filePath },
    globalRoot: plan.globalRoot,
    sourceDir: plan.sourceDir,
    linkPath: plan.linkPath,
    dirs: plan.dirs,
    link: plan.link,
    conflicts: plan.conflicts,
    ok: plan.ok
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderResult(result));
  }

  process.exit(plan.ok ? 0 : 1);
} catch (error) {
  if (options.json) {
    console.log(
      JSON.stringify(
        { dryRun: !options.apply, applied: false, ok: false, error: error.message },
        null,
        2
      )
    );
  } else {
    console.error(`安装失败：${error.message}`);
  }
  process.exit(1);
}

function parseOptions(argv) {
  const parsed = { apply: false, dryRun: false, json: false, help: false };

  for (const arg of argv) {
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`未知参数：${arg}`);
  }

  if (parsed.apply && parsed.dryRun) {
    throw new Error('--apply 与 --dry-run 不能同时使用');
  }
  return parsed;
}

function renderResult(result) {
  const lines = [
    result.applied
      ? '全局工作台已安装'
      : result.ok
        ? '全局工作台安装预演（不会写入）'
        : '全局工作台安装预演（存在冲突，不会写入）',
    `  机器：${result.machine.host}（${result.machine.filePath}）`,
    `  全局工作台：${result.globalRoot}`,
    `  脚本源：${result.sourceDir}`,
    '  目录：',
    ...result.dirs.map((dir) => `    ${statusLabel(dir.action)} ${dir.name}：${dir.path}（${dir.reason}）`),
    '  脚本入口：',
    `    ${statusLabel(result.link.action)} ${result.link.path}`,
    `      目标：${result.link.target}`,
    result.link.currentTarget && result.link.action === 'conflict'
      ? `      当前指向：${result.link.currentTarget}`
      : null,
    '',
    result.ok
      ? result.applied
        ? '结果：已创建缺失目录和脚本 junction'
        : '结果：可直接安装（加 --apply 执行）'
      : `结果：${result.conflicts} 处冲突，请先人工处理`
  ];

  return lines.filter((line) => line !== null).join('\n');
}

function statusLabel(action) {
  return (
    {
      'create-directory': '[新建]',
      'create-junction': '[新建]',
      unchanged: '[无变化]',
      conflict: '[冲突]'
    }[action] ?? `[${action}]`
  );
}

#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from '../core/lib/paths.mjs';
import { actions, getAction } from '../core/registry.mjs';
import { parseArgs } from './args.mjs';
import {
  renderBackup,
  renderBuild,
  renderContent,
  renderDetect,
  renderDeploy,
  renderDoctor,
  renderHelp,
  renderLog,
  renderMerge,
  renderProjectAttach,
  renderProjectDetach,
  renderProjectScan,
  renderSettings,
  renderStatus,
  renderUninstall
} from './render.mjs';

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (error) {
    console.error(`错误：${error.message}`);
    return 1;
  }

  const { command, options } = parsed;

  if (options.version) {
    console.log(readVersion());
    return 0;
  }

  if (options.help || command === 'help') {
    console.log(renderHelp(actions));
    return 0;
  }

  const action = getAction(command);
  if (!action) {
    console.error(`未知命令：${command}`);
    console.error(renderHelp(actions));
    return 1;
  }

  const ctx = { repoRoot: REPO_ROOT, hostname: os.hostname(), now: new Date(), source: 'cli' };
  let result;

  try {
    result = await action.run(ctx, { ...options, positionals: parsed.positionals });
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
    } else {
      console.error(`错误：${error.message}`);
    }
    if (process.env.AIWB_DEBUG) console.error(error.stack);
    return 1;
  }

  if (action.id === 'gui') {
    if (options.json) {
      console.log(JSON.stringify({ ok: true, url: result.url, port: result.port }, null, 2));
    } else {
      console.log(`GUI 已启动：${result.url}`);
      console.log('按 Ctrl+C 停止。');
    }
    await result.whenClosed;
    return 0;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderResult(action, result));
  }

  return exitCode(action, result);
}

function renderResult(action, result) {
  switch (action.id) {
    case 'build':
      return renderBuild(result);
    case 'detect':
      return renderDetect(result);
    case 'deploy':
      return renderDeploy(result);
    case 'merge':
      return renderMerge(result);
    case 'backup':
      return renderBackup(result);
    case 'uninstall':
      return renderUninstall(result);
    case 'scan':
      return renderProjectScan(result);
    case 'attach':
      return renderProjectAttach(result);
    case 'detach':
      return renderProjectDetach(result);
    case 'content':
      return renderContent(result);
    case 'status':
      return renderStatus(result);
    case 'log':
      return renderLog(result);
    case 'settings':
      return renderSettings(result);
    case 'doctor':
      return renderDoctor(result);
    default:
      return JSON.stringify(result, null, 2);
  }
}

function exitCode(action, result) {
  if (action.id === 'build' && result.mode === 'check' && !result.current) return 1;
  if (action.id === 'content' && result.subcommand === 'lint' && !result.ok) return 1;
  if (action.id === 'content' && result.subcommand === 'save' && result.status === 'blocked') {
    return 2;
  }
  if (action.id === 'deploy' && result.apply && !result.apply.ok) return 1;
  if (action.id === 'deploy' && result.summary?.manual > 0) return 2;
  if (action.id === 'merge' && result.status === 'blocked') return 2;
  if (action.id === 'backup' && result.subcommand === 'create' && result.summary?.failed > 0) {
    return 1;
  }
  if (action.id === 'backup' && result.subcommand === 'prune' && result.summary?.failed > 0) {
    return 1;
  }
  if (action.id === 'backup' && result.status === 'blocked') return 2;
  if (action.id === 'uninstall' && result.apply?.failed > 0) return 1;
  if (action.id === 'uninstall' && result.summary?.blocked > 0) return 2;
  if (action.id === 'uninstall' && result.apply && !result.apply.ok) return 1;
  if ((action.id === 'attach' || action.id === 'detach') && result.apply?.failed > 0) return 1;
  if ((action.id === 'attach' || action.id === 'detach') && result.summary?.blocked > 0) return 2;
  if ((action.id === 'attach' || action.id === 'detach') && result.apply && !result.apply.ok) {
    return 1;
  }
  if (action.id === 'doctor' && !result.ok) return 1;
  if (action.id === 'log' && !result.ok) return 1;
  if (action.id === 'settings' && result.subcommand === 'show' && !result.ok) return 1;
  if (
    action.id === 'settings' &&
    result.subcommand !== 'show' &&
    ['blocked', 'preview'].includes(result.status) &&
    !result.ok
  ) {
    return 2;
  }
  return 0;
}

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    return String(pkg.version);
  } catch {
    return 'unknown';
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`错误：${error.message}`);
    if (process.env.AIWB_DEBUG) console.error(error.stack);
    process.exitCode = 1;
  });

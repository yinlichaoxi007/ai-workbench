#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from '../core/lib/paths.mjs';
import { actions, getAction } from '../core/registry.mjs';
import { parseArgs } from './args.mjs';
import {
  renderBuild,
  renderContent,
  renderDetect,
  renderDeploy,
  renderDoctor,
  renderHelp,
  renderStatus
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

  if (command === 'gui') {
    console.error('GUI 尚未实现（P2）。当前请使用 CLI：launchers\\aiwb.cmd <命令>');
    return 3;
  }

  const action = getAction(command);
  if (!action) {
    console.error(`未知命令：${command}`);
    console.error(renderHelp(actions));
    return 1;
  }

  const ctx = { repoRoot: REPO_ROOT, hostname: os.hostname(), now: new Date() };
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
    case 'content':
      return renderContent(result);
    case 'status':
      return renderStatus(result);
    case 'doctor':
      return renderDoctor(result);
    default:
      return JSON.stringify(result, null, 2);
  }
}

function exitCode(action, result) {
  if (action.id === 'build' && result.mode === 'check' && !result.current) return 1;
  if (action.id === 'content' && result.subcommand === 'lint' && !result.ok) return 1;
  if (action.id === 'deploy' && result.summary?.manual > 0) return 2;
  if (action.id === 'doctor' && !result.ok) return 1;
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

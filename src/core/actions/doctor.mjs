import fs from 'node:fs';
import path from 'node:path';
import { checkBuild } from '../lib/entry-builder.mjs';
import { loadMachine } from '../lib/machine.mjs';
import { loadTargets } from '../lib/target-registry.mjs';
import { run as runStatus } from './status.mjs';

/**
 * 运行环境、构建、目标注册表、动作对等性和漂移检查。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{parity?: boolean}} [params] 动作参数
 * @param {Array<object>} actions 动作注册表
 * @returns {Promise<{ok: boolean, checks: Array<object>}>} 检查结果
 */
export async function run(ctx, params = {}, actions = []) {
  const checks = [];

  checks.push(nodeCheck());
  checks.push(machineCheck(ctx));
  checks.push(buildCheck(ctx));
  checks.push(targetsCheck(ctx));
  checks.push(parityCheck(ctx, actions));
  checks.push(await driftCheck(ctx));

  const selected = params.parity ? checks.filter((check) => check.id === 'parity') : checks;
  return { ok: selected.every((check) => check.status !== 'fail'), checks: selected };
}

function nodeCheck() {
  const major = Number(process.versions.node.split('.')[0]);
  return {
    id: 'node',
    title: 'Node.js 版本',
    status: major >= 20 ? 'pass' : 'fail',
    detail: `当前 ${process.version}，要求 >= 20`
  };
}

function machineCheck(ctx) {
  try {
    const machine = loadMachine(ctx.repoRoot, ctx.hostname);
    return {
      id: 'machine',
      title: '机器档案',
      status: 'pass',
      detail: `${machine.host}：${machine.filePath}`
    };
  } catch (error) {
    return { id: 'machine', title: '机器档案', status: 'fail', detail: error.message };
  }
}

function buildCheck(ctx) {
  try {
    const result = checkBuild(ctx.repoRoot, { now: ctx.now, hostname: ctx.hostname });
    if (result.error) {
      return {
        id: 'build',
        title: '构建产物',
        status: 'fail',
        detail: result.error
      };
    }
    return {
      id: 'build',
      title: '构建产物',
      status: result.current ? 'pass' : 'fail',
      detail: result.current
        ? `已是最新：${result.contentHash}`
        : 'dist 缺失或已过期，请运行 aiwb build'
    };
  } catch (error) {
    return { id: 'build', title: '构建产物', status: 'fail', detail: error.message };
  }
}

function targetsCheck(ctx) {
  try {
    const targets = loadTargets(ctx.repoRoot);
    const installed = targets.filter((target) => target.installed).map((target) => target.name);
    return {
      id: 'targets',
      title: '目标注册表',
      status: 'pass',
      detail: `${targets.length} 个目标；已安装：${installed.length ? installed.join('、') : '无'}`
    };
  } catch (error) {
    return { id: 'targets', title: '目标注册表', status: 'fail', detail: error.message };
  }
}

function parityCheck(ctx, actions) {
  const missing = [];
  for (const action of actions) {
    if (!action.cli?.command) missing.push(`${action.id}: 缺少 cli.command`);
    if (!action.gui?.page) missing.push(`${action.id}: 缺少 gui.page`);
    if (!Array.isArray(action.gui?.form)) missing.push(`${action.id}: 缺少 gui.form`);
  }

  const guiServerExists = fs.existsSync(path.join(ctx.repoRoot, 'src', 'gui', 'server.mjs'));
  let status = 'pass';
  let detail = `${actions.length} 个动作的 CLI/GUI 元数据完整`;

  if (missing.length > 0) {
    status = 'fail';
    detail = missing.join('；');
  } else if (!guiServerExists) {
    status = 'pending';
    detail += '；GUI 运行时尚未实现（P2），无法验证真实功能对等';
  }

  return { id: 'parity', title: 'CLI/GUI 功能对等', status, detail };
}

async function driftCheck(ctx) {
  try {
    const status = await runStatus(ctx);
    const drift = status.targets.filter((target) => target.state === 'drift');
    const stale = status.targets.filter((target) => target.state === 'stale');
    return {
      id: 'drift',
      title: '入口漂移',
      status: drift.length > 0 ? 'fail' : 'pass',
      detail:
        drift.length > 0
          ? `发现 ${drift.length} 个入口被修改：${drift.map((target) => target.name).join('、')}`
          : stale.length > 0
            ? `未发现手改；${stale.length} 个入口待重新部署`
            : '未发现漂移'
    };
  } catch (error) {
    return { id: 'drift', title: '入口漂移', status: 'fail', detail: error.message };
  }
}

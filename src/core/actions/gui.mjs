import { execFile } from 'node:child_process';
import { startServer } from '../../gui/server.mjs';
import { ensureBuild } from '../lib/entry-builder.mjs';
import { loadMachine } from '../lib/machine.mjs';

/**
 * 启动本地 GUI，返回访问地址与关闭信号。
 * @param {{repoRoot: string, hostname?: string}} ctx 运行上下文
 * @param {{port?: string|number, open?: boolean}} [params] 启动参数
 * @returns {Promise<{action: string, url: string, port: number, portSource: string, whenClosed: Promise<void>}>} 启动结果
 */
export async function run(ctx, params = {}) {
  const build = ensureGuiBuild(ctx);
  const { port, source } = resolvePort(ctx, params.port);
  const server = await startServer({
    repoRoot: ctx.repoRoot,
    hostname: ctx.hostname,
    port
  });
  const url = `http://127.0.0.1:${server.port}/?token=${server.token}`;

  if (params.open) openBrowser(url);

  return {
    action: 'gui',
    build,
    url,
    port: server.port,
    portSource: source,
    close: server.close,
    whenClosed: server.whenClosed
  };
}

/**
 * 启动 GUI 前确保构建产物与当前内容一致；失败时保留错误，不阻止 GUI 启动。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @returns {{rebuilt: boolean, contentHash?: string, error?: string}} 构建状态
 */
export function ensureGuiBuild(ctx) {
  try {
    const build = ensureBuild(ctx.repoRoot, { now: ctx.now, hostname: ctx.hostname });
    return { rebuilt: build.rebuilt, contentHash: build.contentHash };
  } catch (error) {
    return { rebuilt: false, error: error.message };
  }
}

function resolvePort(ctx, value) {
  if (value !== undefined) return { port: parsePort(value), source: 'option' };

  try {
    const machine = loadMachine(ctx.repoRoot, ctx.hostname);
    const issue = machine.settings.issues.find((item) => item.key === 'guiPort');
    if (issue) throw new Error(issue.message);
    if (machine.settings.guiPort.source === 'machine') {
      return { port: machine.settings.guiPort.value, source: 'machine' };
    }
  } catch (error) {
    if (/guiPort/.test(error.message)) throw error;
    // 没有机器档案时仍允许启动 GUI；具体动作会给出缺失提示。
  }

  return { port: 0, source: 'default' };
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`端口不合法：${value}。用法：aiwb gui [--port <0-65535>] [--open]`);
  }
  return port;
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      execFile('cmd', ['/c', 'start', '', url], { windowsHide: true }, () => {});
    } else if (process.platform === 'darwin') {
      execFile('open', [url], () => {});
    } else {
      execFile('xdg-open', [url], () => {});
    }
  } catch {
    // 打不开浏览器时仍保留控制台地址。
  }
}

import { execFile } from 'node:child_process';
import { startServer } from '../../gui/server.mjs';

/**
 * 启动本地 GUI，返回访问地址与关闭信号。
 * @param {{repoRoot: string, hostname?: string}} ctx 运行上下文
 * @param {{port?: string|number, open?: boolean}} [params] 启动参数
 * @returns {Promise<{action: string, url: string, port: number, whenClosed: Promise<void>}>} 启动结果
 */
export async function run(ctx, params = {}) {
  const port = parsePort(params.port);
  const server = await startServer({
    repoRoot: ctx.repoRoot,
    hostname: ctx.hostname,
    port
  });
  const url = `http://127.0.0.1:${server.port}/?token=${server.token}`;

  if (params.open) openBrowser(url);

  return { action: 'gui', url, port: server.port, whenClosed: server.whenClosed };
}

function parsePort(value) {
  if (value === undefined) return 0;
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

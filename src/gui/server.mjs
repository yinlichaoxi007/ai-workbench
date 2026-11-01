import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as backupAction from '../core/actions/backup.mjs';
import * as buildAction from '../core/actions/build.mjs';
import * as contentAction from '../core/actions/content.mjs';
import * as deployAction from '../core/actions/deploy.mjs';
import * as detectAction from '../core/actions/detect.mjs';
import * as doctorAction from '../core/actions/doctor.mjs';
import * as projectAction from '../core/actions/project.mjs';
import * as statusAction from '../core/actions/status.mjs';
import * as uninstallAction from '../core/actions/uninstall.mjs';
import { loadMachine } from '../core/lib/machine.mjs';
import { isAllowedProjectPath, PROJECT_MODES } from '../core/lib/projects.mjs';

const HOST = '127.0.0.1';
const IDLE_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');

const RUNNERS = {
  status: (ctx) => statusAction.run(ctx),
  detect: (ctx) => detectAction.run(ctx),
  doctor: async (ctx, params) => {
    const { actions } = await import('../core/registry.mjs');
    return doctorAction.run(ctx, params, actions);
  },
  build: (ctx, params) => buildAction.run(ctx, params),
  content: (ctx, params) => contentAction.run(ctx, params),
  deploy: (ctx, params) => deployAction.run(ctx, params),
  backup: (ctx, params) => backupAction.run(ctx, params),
  uninstall: (ctx, params) => uninstallAction.run(ctx, params),
  scan: (ctx, params) => projectAction.runScan(ctx, params),
  attach: (ctx, params) => projectAction.runAttach(ctx, params),
  detach: (ctx, params) => projectAction.runDetach(ctx, params)
};

/**
 * 启动只监听本机回环地址的 GUI 服务。
 * @param {{repoRoot: string, hostname: string, port?: number}} options 启动选项
 * @returns {Promise<{port: number, token: string, close: () => void, whenClosed: Promise<void>}>} 服务句柄
 */
export async function startServer(options) {
  const token = randomBytes(32).toString('hex');

  const server = http.createServer((request, response) => {
    touchIdle();
    handleRequest({ request, response, token, repoRoot: options.repoRoot, hostname: options.hostname }).catch(
      (error) => {
        sendJson(response, error.statusCode ?? 500, {
          ok: false,
          error: error.message
        });
      }
    );
  });

  let idleTimer = null;
  const close = () => {
    if (idleTimer) clearTimeout(idleTimer);
    server.close();
    server.closeAllConnections?.();
  };
  const touchIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(close, IDLE_MS);
    idleTimer.unref?.();
  };
  touchIdle();

  const whenClosed = new Promise((resolve) => {
    server.on('close', resolve);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    port: server.address().port,
    token,
    close,
    whenClosed
  };
}

async function handleRequest({ request, response, token, repoRoot, hostname }) {
  const url = new URL(request.url, `http://${HOST}`);

  if (request.method === 'GET' && (url.pathname === '/app.js' || url.pathname === '/style.css')) {
    return serveStatic(url.pathname, response);
  }

  if (!isAuthorized(request, url, token)) {
    const message = '缺少或错误的访问令牌。请使用 aiwb gui 输出的完整地址打开。';
    if (url.pathname.startsWith('/api/')) {
      return sendJson(response, 403, { ok: false, error: message });
    }
    return sendText(response, 403, message);
  }

  if (request.method === 'GET' && url.pathname === '/') {
    const html = fs.readFileSync(path.join(WEB_DIR, 'index.html'));
    response.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
    response.end(html);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/run') {
    const body = await readJson(request);
    const result = await runAction({ body, repoRoot, hostname });
    return sendJson(response, 200, { ok: true, result });
  }

  if (request.method === 'GET' && url.pathname === '/api/ping') {
    return sendJson(response, 200, { ok: true });
  }

  sendJson(response, 404, { ok: false, error: '未知接口' });
}

async function runAction({ body, repoRoot, hostname }) {
  const action = typeof body?.action === 'string' ? body.action : '';
  const runner = RUNNERS[action];
  if (!runner) {
    throw httpError(400, `不支持的动作：${action || '（未指定）'}`);
  }

  const params = sanitizeParams(body?.params);
  assertAllowed(action, params, { repoRoot, hostname });
  const writes = params.apply || (action === 'backup' && params.positionals[0] === 'create');
  if (writes && body?.confirm !== true) {
    throw httpError(403, '执行写入前需要在界面中确认');
  }

  return runner(
    { repoRoot, hostname, now: new Date() },
    { ...params, positionals: params.positionals }
  );
}

function assertAllowed(action, params, { repoRoot, hostname }) {
  if (action === 'build' && !params.check) {
    throw httpError(403, 'GUI 只允许 build --check，不写入构建产物');
  }
  if (action === 'content' && params.positionals[0] !== 'lint') {
    throw httpError(403, 'GUI 只允许 content lint');
  }
  if (
    action === 'backup' &&
    !['list', 'create', 'prune', 'restore'].includes(params.positionals[0])
  ) {
    throw httpError(
      400,
      '用法：backup list、backup create、backup prune 或 backup restore <工具 id> <时间戳>'
    );
  }
  if (action === 'deploy' && params.apply && params.dryRun) {
    throw httpError(400, 'apply 与 dryRun 不能同时使用');
  }
  if (action === 'scan' && params.root) {
    throw httpError(403, 'GUI 扫描只使用机器档案中的项目父级，不接收自定义路径');
  }
  if (action === 'attach' || action === 'detach') {
    if (!params.path || !path.isAbsolute(params.path)) {
      throw httpError(400, '需要项目绝对路径');
    }
    if (params.apply && params.dryRun) {
      throw httpError(400, 'apply 与 dryRun 不能同时使用');
    }
    if (action === 'attach' && params.mode && !PROJECT_MODES.includes(params.mode)) {
      throw httpError(400, `未知挂载方式：${params.mode}`);
    }
    let allowed = false;
    try {
      allowed = isAllowedProjectPath(loadMachine(repoRoot, hostname), params.path);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      throw httpError(403, '项目不在机器档案允许的范围内；先在机器档案登记或让扫描发现该项目');
    }
  }
}

function sanitizeParams(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    tool: typeof input.tool === 'string' ? input.tool : undefined,
    path: typeof input.path === 'string' ? input.path : undefined,
    root: typeof input.root === 'string' ? input.root : undefined,
    mode: typeof input.mode === 'string' ? input.mode : undefined,
    keep:
      typeof input.keep === 'string' || typeof input.keep === 'number'
        ? input.keep
        : undefined,
    check: input.check === true,
    apply: input.apply === true,
    dryRun: input.dryRun === true,
    force: input.force === true,
    parity: input.parity === true,
    positionals: Array.isArray(input.positionals)
      ? input.positionals.filter((item) => typeof item === 'string')
      : []
  };
}

function isAuthorized(request, url, token) {
  const header = request.headers['x-aiwb-token'];
  const query = url.searchParams.get('token');
  return header === token || query === token;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(httpError(413, '请求体过大'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError(400, '请求体不是合法 JSON'));
      }
    });
    request.on('error', reject);
  });
}

function serveStatic(pathname, response) {
  const fileName = pathname === '/app.js' ? 'app.js' : 'style.css';
  const contentType =
    fileName === 'app.js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8';
  const filePath = path.join(WEB_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    sendText(response, 404, '静态资源不存在');
    return;
  }

  response.writeHead(200, securityHeaders({ 'Content-Type': contentType }));
  response.end(fs.readFileSync(filePath));
}

function securityHeaders(extra) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
    'X-Content-Type-Options': 'nosniff',
    ...extra
  };
}

function sendJson(response, statusCode, payload) {
  if (response.headersSent) return;
  response.writeHead(statusCode, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(response, statusCode, text) {
  if (response.headersSent) return;
  response.writeHead(statusCode, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
  response.end(`${text}\n`);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

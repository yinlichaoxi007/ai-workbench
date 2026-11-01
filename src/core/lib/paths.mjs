import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);

const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|%([A-Za-z_][A-Za-z0-9_]*)%/g;

/**
 * 展开路径字符串中的环境变量引用。
 * 支持 ${NAME} 与 %NAME%；Windows 下变量名按不区分大小写查找。
 * @param {string} value 原始路径
 * @param {Record<string, string|undefined>} [env] 环境变量
 * @returns {{value: string, missing: string[]}} 展开结果与缺失变量
 */
export function expandEnv(value, env = process.env) {
  if (typeof value !== 'string' || value.length === 0) {
    return { value, missing: [] };
  }

  const missing = new Set();
  const expanded = value.replace(ENV_REFERENCE, (match, braced, percent) => {
    const name = braced ?? percent;
    const resolved = lookupEnv(env, name);
    if (resolved === undefined) {
      missing.add(name);
      return match;
    }
    return resolved;
  });

  return { value: expanded, missing: [...missing] };
}

/**
 * 展开环境变量与开头的 ~，返回最终路径。
 * @param {string} value 原始路径
 * @param {Record<string, string|undefined>} [env] 环境变量
 * @returns {string} 展开后的路径
 */
export function expandPath(value, env = process.env) {
  if (typeof value !== 'string' || value.length === 0) return value;
  const { value: expanded, missing } = expandEnv(value, env);
  if (missing.length > 0) {
    throw new Error(
      `路径引用了未定义的环境变量：${missing.join('、')}（原值：${value}）。请在机器档案的“## 设置”里定义，或改用绝对路径。`
    );
  }
  return expandHome(expanded);
}

/**
 * 展开路径开头的 ~ 为用户目录。
 * @param {string} value 原始路径
 * @returns {string} 展开后的路径；非字符串原样返回
 */
export function expandHome(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

/**
 * 展开并规范化为本机路径。
 * @param {string} value 原始路径
 * @param {Record<string, string|undefined>} [env] 环境变量
 * @returns {string} 本机绝对或相对路径
 */
export function resolvePath(value, env = process.env) {
  return path.normalize(expandPath(value, env));
}

function lookupEnv(env, name) {
  if (Object.hasOwn(env, name) && typeof env[name] === 'string') return env[name];
  if (process.platform !== 'win32') return undefined;

  const upper = name.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === upper && typeof value === 'string') return value;
  }
  return undefined;
}

/**
 * 将路径转换为统一的正斜杠形式，便于跨平台比较和写入清单。
 * @param {string} value 原始路径
 * @returns {string} 正斜杠路径
 */
export function toPosixPath(value) {
  return value.replace(/\\/g, '/');
}

/**
 * 返回当前主机的机器档案路径，找不到时抛出可操作的错误。
 * @param {string} repoRoot 仓库根目录
 * @param {string} [hostname] 主机名，默认取 os.hostname()
 * @returns {string} 机器档案绝对路径
 */
export function findMachineFile(repoRoot, hostname = os.hostname()) {
  const machineDir = path.join(repoRoot, 'machines');
  const expected = path.join(machineDir, `${hostname}.md`);
  if (fs.existsSync(expected)) return expected;

  if (fs.existsSync(machineDir)) {
    const target = `${hostname}.md`.toLowerCase();
    const matched = fs
      .readdirSync(machineDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase() === target)
      .map((entry) => path.join(machineDir, entry.name))[0];
    if (matched) return matched;
  }

  throw new Error(
    `找不到机器档案 machines/${hostname}.md。请复制 machines/_template.md 为对应文件，填写路径后再运行。`
  );
}

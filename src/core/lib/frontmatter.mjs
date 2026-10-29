/**
 * 解析 Markdown 文件头部的简单 YAML frontmatter。
 * 仅支持 key: value 形式，不引入 YAML 依赖。
 * @param {string} text 文件内容
 * @returns {{meta: Record<string, string|number|boolean>, body: string}} 元数据与正文
 */
export function parseFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { meta: {}, body: normalized };

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf(':');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key) continue;
    meta[key] = coerceValue(rawValue);
  }

  return { meta, body: normalized.slice(match[0].length) };
}

function coerceValue(rawValue) {
  if (/^-?\d+$/.test(rawValue)) return Number(rawValue);
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  return rawValue;
}

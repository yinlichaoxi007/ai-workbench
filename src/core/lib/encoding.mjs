/**
 * 解码文本文件并识别 BOM 与编码。
 * 非 UTF-8 文件不参与自动合并，交由人工处理。
 * @param {Buffer} buffer 文件原始字节
 * @returns {{encoding: string, text: string|null, hasBom: boolean}} 解码结果
 */
export function decodeText(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      encoding: 'utf-8-bom',
      text: new TextDecoder('utf-8').decode(buffer.subarray(3)),
      hasBom: true
    };
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {
      encoding: 'utf-16le',
      text: new TextDecoder('utf-16le').decode(buffer.subarray(2)),
      hasBom: true
    };
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return {
      encoding: 'utf-16be',
      text: new TextDecoder('utf-16be').decode(buffer.subarray(2)),
      hasBom: true
    };
  }

  try {
    return {
      encoding: 'utf-8',
      text: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
      hasBom: false
    };
  } catch {
    return { encoding: 'non-utf8', text: null, hasBom: false };
  }
}

/**
 * 按指定编码编码文本，并按需补回 BOM。
 * @param {string} text 文本
 * @param {{encoding?: string, hasBom?: boolean}} [options] 编码选项
 * @returns {Buffer} 编码后的字节
 */
export function encodeText(text, options = {}) {
  const encoding = options.encoding ?? 'utf-8';
  const hasBom = options.hasBom ?? false;

  if (encoding === 'utf-16le') {
    const body = Buffer.from(text, 'utf16le');
    return hasBom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body;
  }

  if (encoding === 'utf-16be') {
    const le = Buffer.from(text, 'utf16le');
    const be = Buffer.alloc(le.length);
    for (let i = 0; i < le.length; i += 2) {
      be[i] = le[i + 1];
      be[i + 1] = le[i];
    }
    return hasBom ? Buffer.concat([Buffer.from([0xfe, 0xff]), be]) : be;
  }

  const body = Buffer.from(text, 'utf8');
  return hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

/**
 * 检测文本的主要换行风格。
 * @param {string} text 文本
 * @returns {'\r\n'|'\n'} 换行符
 */
export function detectNewline(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * 将文本统一为 LF，便于哈希和比较。
 * @param {string} text 文本
 * @returns {string} LF 文本
 */
export function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n');
}

/**
 * 将文本换行符转换为指定风格。
 * @param {string} text 文本
 * @param {'\r\n'|'\n'} newline 目标换行符
 * @returns {string} 转换后的文本
 */
export function convertNewlines(text, newline) {
  const normalized = normalizeNewlines(text);
  return newline === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

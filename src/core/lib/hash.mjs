import { createHash } from 'node:crypto';

/**
 * 计算内容的 SHA-256 指纹。
 * @param {string|Buffer} data 待计算的内容
 * @returns {string} 带 sha256: 前缀的十六进制指纹
 */
export function sha256(data) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

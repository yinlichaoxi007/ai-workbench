import fs from 'node:fs';
import path from 'node:path';

/**
 * 通过临时文件加原子替换写入文本，避免中途失败留下半截文件。
 * @param {string} filePath 目标文件路径
 * @param {string|Buffer} data 待写入内容
 * @param {BufferEncoding} [encoding] 文本编码，默认 utf8
 */
export function atomicWriteFile(filePath, data, encoding = 'utf8') {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });

  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;

  try {
    fs.writeFileSync(tempPath, data, encoding);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // 清理临时文件失败不覆盖原始错误。
    }
    throw error;
  }
}

/**
 * 读取文本文件，保留原始换行与 BOM 判断所需的字节语义。
 * @param {string} filePath 文件路径
 * @returns {Buffer} 文件内容
 */
export function readBinaryFile(filePath) {
  return fs.readFileSync(filePath);
}

/**
 * 递归收集目录下的普通文件。
 * @param {string} root 起始目录
 * @param {(filePath: string) => boolean} [filter] 过滤函数
 * @returns {string[]} 文件绝对路径，按路径排序
 */
export function listFiles(root, filter = () => true) {
  if (!fs.existsSync(root)) return [];

  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFiles(fullPath, filter));
    } else if (entry.isFile() && filter(fullPath)) {
      result.push(fullPath);
    }
  }
  return result.sort((a, b) => a.localeCompare(b, 'en'));
}

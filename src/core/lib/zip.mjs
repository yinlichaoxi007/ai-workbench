import { atomicWriteFile } from './fs-safe.mjs';

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const VERSION = 20;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

const CRC_TABLE = buildCrcTable();

/**
 * 计算 CRC-32（ZIP 使用的反射多项式）。
 * @param {Buffer|string} data 数据
 * @returns {number} 无符号 32 位 CRC
 */
export function crc32(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 生成只存储不压缩的 ZIP 缓冲。
 * @param {Array<{name: string, data: Buffer|string}>} entries 文件条目，名称使用正斜杠
 * @param {{date?: Date}} [options] 选项
 * @returns {Buffer} ZIP 内容
 */
export function createZip(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('ZIP 至少需要一个文件');
  }
  if (entries.length > MAX_UINT16) {
    throw new Error(`ZIP 文件数超过上限：${entries.length}`);
  }

  const date = options.date instanceof Date ? options.date : new Date();
  const { dosTime, dosDate } = toDosDateTime(date);
  const seen = new Set();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = normalizeName(entry?.name);
    if (seen.has(name)) throw new Error(`ZIP 存在重复文件：${name}`);
    seen.add(name);

    const data = toBuffer(entry?.data);
    if (data.length > MAX_UINT32) throw new Error(`ZIP 文件过大：${name}`);
    const nameBuffer = Buffer.from(name, 'utf8');
    if (nameBuffer.length > MAX_UINT16) throw new Error(`ZIP 文件名过长：${name}`);
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
    if (offset > MAX_UINT32) throw new Error('ZIP 总大小超过上限');
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

/**
 * 生成 ZIP 并原子写入目标文件。
 * @param {string} filePath 目标路径
 * @param {Array<{name: string, data: Buffer|string}>} entries 文件条目
 * @param {{date?: Date}} [options] 选项
 * @returns {{path: string, bytes: number, entries: number}} 写入结果
 */
export function writeZip(filePath, entries, options = {}) {
  const buffer = createZip(entries, options);
  atomicWriteFile(filePath, buffer);
  return { path: filePath, bytes: buffer.length, entries: entries.length };
}

function normalizeName(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('ZIP 文件名不能为空');
  }

  const name = value.replaceAll('\\', '/');
  if (name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw new Error(`ZIP 文件名必须是相对路径：${value}`);
  }
  if (name.endsWith('/')) throw new Error(`ZIP 不支持目录条目：${value}`);

  const segments = name.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`ZIP 文件名不能包含空段、. 或 ..：${value}`);
  }
  return name;
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error('ZIP 文件内容必须是字符串、Buffer 或 Uint8Array');
}

function toDosDateTime(date) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
    dosTime: (hours << 11) | (minutes << 5) | seconds
  };
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

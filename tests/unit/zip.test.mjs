import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32, createZip, writeZip } from '../../src/core/lib/zip.mjs';

function readZip(buffer) {
  const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(endOffset, -1, '缺少 ZIP 结尾记录');

  const count = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  let offset = centralOffset;

  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const checksum = buffer.readUInt32LE(offset + 16);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + size);

    entries.push({ name, flags, method, checksum, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  assert.equal(offset, centralOffset + centralSize);
  return entries;
}

test('CRC-32 与标准测试向量一致', () => {
  assert.equal(crc32('123456789'), 0xcbf43926);
  assert.equal(crc32(''), 0);
  assert.equal(crc32(Buffer.from('123456789', 'utf8')), 0xcbf43926);
});

test('生成只存储 ZIP 并保留名称、内容与 CRC', () => {
  const buffer = createZip(
    [
      { name: 'summary.json', data: '{"ok":true}\n' },
      { name: 'nested/readme.md', data: Buffer.from('中文内容\n', 'utf8') }
    ],
    { date: new Date(2026, 10, 1, 12, 34, 56) }
  );

  assert.equal(buffer.readUInt32LE(0), 0x04034b50);
  const entries = readZip(buffer);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['summary.json', 'nested/readme.md']
  );
  for (const entry of entries) {
    assert.equal(entry.flags, 0x0800);
    assert.equal(entry.method, 0);
    assert.equal(entry.checksum, crc32(entry.data));
  }
  assert.equal(entries[0].data.toString('utf8'), '{"ok":true}\n');
  assert.equal(entries[1].data.toString('utf8'), '中文内容\n');
});

test('writeZip 原子写入目标文件', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-zip-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'nested', 'diagnose.zip');

  const written = writeZip(target, [{ name: 'a.txt', data: 'a' }], {
    date: new Date(2026, 10, 1)
  });

  assert.equal(written.path, target);
  assert.equal(written.entries, 1);
  assert.equal(written.bytes, fs.statSync(target).size);
  const entries = readZip(fs.readFileSync(target));
  assert.equal(entries[0].name, 'a.txt');
  assert.equal(entries[0].data.toString('utf8'), 'a');
});

test('拒绝空条目、目录条目、绝对路径与 .. 路径', () => {
  assert.throws(() => createZip([]), /至少需要一个文件/);
  for (const name of ['', '/abs.txt', 'C:/abs.txt', 'a//b.txt', './a.txt', 'a/../b.txt']) {
    assert.throws(
      () => createZip([{ name, data: 'x' }]),
      /文件名/,
      `${name} 应被拒绝`
    );
  }
  assert.throws(() => createZip([{ name: 'dir/', data: 'x' }]), /目录条目/);
  assert.throws(
    () => createZip([{ name: 'a.txt', data: '1' }, { name: 'a.txt', data: '2' }]),
    /重复文件/
  );
});

test('反斜杠文件名转为正斜杠', () => {
  const entries = readZip(createZip([{ name: 'dir\\file.txt', data: 'x' }]));
  assert.equal(entries[0].name, 'dir/file.txt');
});

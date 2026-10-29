import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertNewlines,
  decodeText,
  detectNewline,
  encodeText,
  normalizeNewlines
} from '../../src/core/lib/encoding.mjs';

test('识别 UTF-8 BOM 并去掉 BOM', () => {
  const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('你好', 'utf8')]);
  const decoded = decodeText(buffer);
  assert.equal(decoded.encoding, 'utf-8-bom');
  assert.equal(decoded.hasBom, true);
  assert.equal(decoded.text, '你好');
});

test('识别 UTF-16LE BOM', () => {
  const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('入口', 'utf16le')]);
  const decoded = decodeText(buffer);
  assert.equal(decoded.encoding, 'utf-16le');
  assert.equal(decoded.text, '入口');
});

test('非 UTF-8 字节不自动解码', () => {
  const decoded = decodeText(Buffer.from([0xc3, 0x28]));
  assert.equal(decoded.encoding, 'non-utf8');
  assert.equal(decoded.text, null);
});

test('编码后再解码保持一致', () => {
  const original = '中文入口\n第二行\n';
  for (const options of [
    { encoding: 'utf-8', hasBom: false },
    { encoding: 'utf-8', hasBom: true },
    { encoding: 'utf-16le', hasBom: true }
  ]) {
    const decoded = decodeText(encodeText(original, options));
    assert.equal(decoded.text, original);
    assert.equal(decoded.hasBom, options.hasBom);
  }
});

test('换行风格检测与转换', () => {
  assert.equal(detectNewline('a\r\nb\n'), '\r\n');
  assert.equal(detectNewline('a\nb\n'), '\n');
  assert.equal(normalizeNewlines('a\r\nb'), 'a\nb');
  assert.equal(convertNewlines('a\nb', '\r\n'), 'a\r\nb');
});

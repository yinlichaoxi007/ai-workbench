import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../../src/core/lib/frontmatter.mjs';
import { extractSections, parseBullets, parseTable } from '../../src/core/lib/machine.mjs';

test('解析 frontmatter 与正文', () => {
  const text = ['---', 'host: TEST-HOST', 'backupRetention: 10', 'enabled: true', '---', '', '# 标题', '正文'].join('\n');
  const { meta, body } = parseFrontmatter(text);

  assert.equal(meta.host, 'TEST-HOST');
  assert.equal(meta.backupRetention, 10);
  assert.equal(meta.enabled, true);
  assert.equal(body.trim(), '# 标题\n正文');
});

test('没有 frontmatter 时正文保持原样', () => {
  const { meta, body } = parseFrontmatter('# 标题\n正文');
  assert.deepEqual(meta, {});
  assert.equal(body, '# 标题\n正文');
});

test('解析中文冒号、英文冒号和盘符冒号', () => {
  const paths = parseBullets(
    ['- 项目父级：X:\\projects', '- 工作参考资料: X:\\references', '- 无分隔符', '- 项目清单：X:\\projects\\bench'].join('\n')
  );

  assert.equal(paths['项目父级'], 'X:\\projects');
  assert.equal(paths['工作参考资料'], 'X:\\references');
  assert.equal(paths['项目清单'], 'X:\\projects\\bench');
  assert.equal(Object.keys(paths).length, 3);
});

test('按二级标题切分段落', () => {
  const sections = extractSections('# 标题\n\n## 路径\n- 项目父级：X:\\projects\n\n## 项目清单\n| 名称 | 路径 |\n|---|---|\n| 示例 | X:\\projects\\demo |');
  assert.equal(sections['路径'], '- 项目父级：X:\\projects');
  assert.match(sections['项目清单'], /\| 示例 \|/);
});

test('解析 Markdown 表格', () => {
  const rows = parseTable('| 名称 | 路径 | 技术栈 |\n|---|---|---|\n| demo | X:\\projects\\demo | Node |\n| tool | X:\\projects\\tool | Python |');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { 名称: 'demo', 路径: 'X:\\projects\\demo', 技术栈: 'Node' });
});

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { toPosixPath } from './paths.mjs';

/**
 * 扫描 content/skills 下的技能目录。
 * @param {string} repoRoot 仓库根目录
 * @returns {Array<{name: string, description: string, dir: string, file: string, relativeFile: string}>} 技能列表
 */
export function listSkills(repoRoot) {
  const skillsDir = path.join(repoRoot, 'content', 'skills');
  if (!fs.existsSync(skillsDir)) return [];

  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(skillsDir, entry.name);
      const file = path.join(dir, 'SKILL.md');
      if (!fs.existsSync(file)) return null;

      const { meta } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      const builtin = meta.builtin === true || String(meta.builtin).toLowerCase() === 'true';
      return {
        name: String(meta.name || entry.name),
        description: String(meta.description || '').trim(),
        builtin,
        dir,
        file,
        relativeFile: toPosixPath(path.relative(repoRoot, file))
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

/**
 * 生成入口中的技能索引。
 * @param {ReturnType<typeof listSkills>} skills 技能列表
 * @returns {string} Markdown 列表
 */
export function renderSkillsIndex(skills) {
  if (skills.length === 0) {
    return '（暂无自研技能；以后由 `content/skills/` 下的 `SKILL.md` 自动生成索引。）';
  }

  return skills
    .map((skill) => {
      const description = skill.description || '（无描述）';
      const badge = skill.builtin ? '（内置）' : '';
      return `- ${skill.name}${badge}：${description}（\`${skill.relativeFile}\`）`;
    })
    .join('\n');
}

import fs from 'node:fs';
import path from 'node:path';
import { listSkills } from './skills-index.mjs';

/**
 * 规划各工具技能目录与 content/skills 的 junction，不写入磁盘。
 * @param {string} repoRoot 仓库根目录
 * @param {Array<object>} tools 已解析的目标列表
 * @returns {{
 *   sourceDir: string,
 *   skills: Array<{name: string, dir: string}>,
 *   tools: Array<object>,
 *   summary: {create: number, unchanged: number, conflict: number, skipped: number, failed: number},
 *   ok: boolean,
 *   applied: boolean
 * }} 技能 junction 预演
 */
export function planSkillJunctions(repoRoot, tools) {
  const sourceDir = path.join(repoRoot, 'content', 'skills');
  const skills = listSkills(repoRoot).map((skill) => ({ name: skill.name, dir: skill.dir }));
  const toolPlans = tools.map((tool) => planTool(tool, skills));
  const summary = summarize(toolPlans, skills.length);

  return {
    sourceDir,
    skills,
    tools: toolPlans,
    summary,
    ok: summary.failed === 0,
    applied: false
  };
}

/**
 * 按预演结果创建技能目录与 junction；已存在的目录、用户技能和异向链接保持不动。
 * @param {ReturnType<typeof planSkillJunctions>} plan 预演结果
 * @returns {ReturnType<typeof planSkillJunctions>} 带写入结果的结果
 */
export function applySkillJunctions(plan) {
  const result = {
    ...plan,
    tools: plan.tools.map((tool) => ({
      ...tool,
      links: tool.links.map((link) => ({ ...link }))
    })),
    applied: true
  };

  let created = 0;
  let unchanged = 0;
  let conflict = plan.summary.conflict;
  let failed = 0;
  let skipped = 0;

  for (const tool of result.tools) {
    if (tool.action === 'no-skills' || tool.action.startsWith('skip-')) {
      tool.applyStatus = 'skipped';
      skipped += 1;
      continue;
    }
    if (tool.action === 'conflict') {
      tool.applyStatus = 'skipped';
      continue;
    }

    if (tool.action === 'create-directory') {
      try {
        fs.mkdirSync(tool.skillsDir, { recursive: true });
      } catch (error) {
        tool.applyStatus = 'failed';
        tool.error = `创建技能目录失败：${error.message}`;
        for (const link of tool.links) {
          link.applyStatus = 'failed';
          link.error = tool.error;
          failed += 1;
        }
        continue;
      }
    }

    let toolCreated = 0;
    let toolFailed = 0;
    let toolConflict = 0;
    for (const link of tool.links) {
      if (link.action === 'unchanged') {
        link.applyStatus = 'unchanged';
        unchanged += 1;
        continue;
      }
      if (link.action === 'conflict') {
        link.applyStatus = 'skipped';
        toolConflict += 1;
        continue;
      }

      try {
        fs.symlinkSync(link.target, link.path, 'junction');
        link.applyStatus = 'created';
        toolCreated += 1;
        created += 1;
      } catch (error) {
        link.applyStatus = 'failed';
        link.error = error.message;
        toolFailed += 1;
        failed += 1;
      }
    }

    if (toolFailed > 0) tool.applyStatus = 'failed';
    else if (toolCreated > 0) tool.applyStatus = 'created';
    else if (toolConflict > 0) tool.applyStatus = 'skipped';
    else tool.applyStatus = 'unchanged';
  }

  result.summary = {
    create: created,
    unchanged,
    conflict,
    skipped,
    failed,
    skills: plan.skills.length
  };
  result.ok = failed === 0;

  return result;
}

function planTool(tool, skills) {
  const base = {
    id: tool.id,
    name: tool.name,
    skillsDir: tool.skillsDir,
    skillsDirExists: tool.skillsDirExists,
    skillsStatus: tool.skillsStatus ?? null,
    dirAction: null,
    links: [],
    applyStatus: null
  };

  if (!tool.enabled) {
    return { ...base, action: 'skip-disabled', reason: '预留目标，尚未启用' };
  }
  if (!tool.installed) {
    return {
      ...base,
      action: 'skip-not-installed',
      reason: `配置目录不存在：${tool.configRoot}`
    };
  }
  if (!tool.skillsDir) {
    return { ...base, action: 'skip-unsupported', reason: '未登记技能目录' };
  }
  if (skills.length === 0) {
    return { ...base, action: 'no-skills', reason: '暂无自建技能' };
  }

  let stat;
  try {
    stat = fs.statSync(tool.skillsDir);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      return {
        ...base,
        action: 'conflict',
        dirAction: 'conflict',
        reason: `技能目录无法访问：${error.message}`
      };
    }
  }

  if (stat && !stat.isDirectory()) {
    return {
      ...base,
      action: 'conflict',
      dirAction: 'conflict',
      reason: '技能目录路径已存在但不是目录'
    };
  }

  const links = skills.map((skill) => planLink(tool.skillsDir, skill));
  return {
    ...base,
    action: stat ? 'ready' : 'create-directory',
    dirAction: stat ? 'unchanged' : 'create-directory',
    reason: stat ? '技能目录已存在' : '技能目录不存在，将创建',
    links
  };
}

function planLink(skillsDir, skill) {
  const linkPath = path.join(skillsDir, skill.name);
  const base = {
    skill: skill.name,
    path: linkPath,
    target: skill.dir,
    currentTarget: null,
    applyStatus: null
  };

  let stat;
  try {
    stat = fs.lstatSync(linkPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ...base, action: 'create-junction', reason: '链接不存在' };
    }
    return { ...base, action: 'conflict', reason: `链接无法访问：${error.message}` };
  }

  if (!stat.isSymbolicLink()) {
    return {
      ...base,
      action: 'conflict',
      reason: '同名路径已存在且不是 junction，可能是用户自建技能'
    };
  }

  let currentTarget;
  try {
    currentTarget = fs.realpathSync(linkPath);
  } catch (error) {
    return { ...base, action: 'conflict', reason: `链接无法解析：${error.message}` };
  }

  if (samePath(currentTarget, skill.dir)) {
    return { ...base, currentTarget, action: 'unchanged', reason: '已指向技能源' };
  }
  return {
    ...base,
    currentTarget,
    action: 'conflict',
    reason: `已指向其他位置：${currentTarget}`
  };
}

function summarize(tools, skillCount) {
  const links = tools.flatMap((tool) => tool.links);
  return {
    create: links.filter((link) => link.action === 'create-junction').length,
    unchanged: links.filter((link) => link.action === 'unchanged').length,
    conflict:
      links.filter((link) => link.action === 'conflict').length +
      tools.filter((tool) => tool.action === 'conflict').length,
    skipped: tools.filter((tool) => tool.action.startsWith('skip-')).length,
    failed: 0,
    skills: skillCount
  };
}

function samePath(left, right) {
  const normalize = (value) =>
    path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
  return normalize(left) === normalize(right);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applySkillJunctions,
  planSkillJunctions
} from '../../src/core/lib/skills-junction.mjs';

function makeRepo(t, skillNames = ['demo']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-skills-'));
  const repo = path.join(root, 'repo');

  for (const name of skillNames) {
    const dir = path.join(repo, 'content', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} 技能\n---\n\n# ${name}\n`,
      'utf8'
    );
  }
  if (skillNames.length === 0) {
    fs.mkdirSync(repo, { recursive: true });
  }

  t.after(() => removeTree(root));
  return { root, repo, home: path.join(root, 'home') };
}

function removeTree(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(target);
    return;
  }
  if (!stat.isDirectory()) {
    fs.unlinkSync(target);
    return;
  }
  for (const entry of fs.readdirSync(target)) {
    removeTree(path.join(target, entry));
  }
  fs.rmdirSync(target);
}

function makeTool(overrides) {
  return {
    id: 'demo-tool',
    name: '演示工具',
    enabled: true,
    installed: true,
    configRoot: path.join(os.tmpdir(), 'aiwb-demo-config'),
    skillsDir: null,
    skillsStatus: 'verified',
    ...overrides
  };
}

test('技能目录缺失时规划创建目录与 junction，未安装或预留工具跳过', (t) => {
  const { home, repo } = makeRepo(t);
  const skillsDir = path.join(home, '.demo', 'skills');
  const plan = planSkillJunctions(repo, [
    makeTool({ skillsDir }),
    makeTool({ id: 'disabled', name: '预留工具', enabled: false, skillsDir }),
    makeTool({ id: 'missing', name: '未安装工具', installed: false, skillsDir }),
    makeTool({ id: 'no-skills-dir', name: '未登记技能目录', skillsDir: null })
  ]);

  assert.equal(plan.ok, true);
  assert.equal(plan.applied, false);
  assert.equal(plan.summary.skills, 1);
  assert.equal(plan.summary.create, 1);

  const [tool, disabled, missing, unsupported] = plan.tools;
  assert.equal(tool.action, 'create-directory');
  assert.equal(tool.dirAction, 'create-directory');
  assert.equal(tool.links.length, 1);
  assert.equal(tool.links[0].action, 'create-junction');
  assert.equal(tool.links[0].path, path.join(skillsDir, 'demo'));
  assert.equal(tool.links[0].target, path.join(repo, 'content', 'skills', 'demo'));

  assert.equal(disabled.action, 'skip-disabled');
  assert.equal(missing.action, 'skip-not-installed');
  assert.equal(unsupported.action, 'skip-unsupported');
  assert.equal(plan.summary.skipped, 3);
});

test('执行写入创建技能目录与 junction，重复执行幂等', (t) => {
  const { home, repo } = makeRepo(t);
  const skillsDir = path.join(home, '.demo', 'skills');
  const tool = makeTool({ skillsDir });

  const applied = applySkillJunctions(planSkillJunctions(repo, [tool]));
  assert.equal(applied.applied, true);
  assert.equal(applied.ok, true);
  assert.equal(applied.summary.create, 1);
  assert.equal(applied.tools[0].applyStatus, 'created');
  assert.equal(applied.tools[0].links[0].applyStatus, 'created');

  const linkPath = path.join(skillsDir, 'demo');
  assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
  assert.equal(
    path.resolve(fs.realpathSync(linkPath)),
    path.resolve(fs.realpathSync(path.join(repo, 'content', 'skills', 'demo')))
  );

  const again = planSkillJunctions(repo, [tool]);
  assert.equal(again.tools[0].action, 'ready');
  assert.equal(again.tools[0].links[0].action, 'unchanged');
  assert.equal(again.summary.create, 0);
  assert.equal(again.summary.unchanged, 1);

  const reapplied = applySkillJunctions(again);
  assert.equal(reapplied.ok, true);
  assert.equal(reapplied.tools[0].applyStatus, 'unchanged');
  assert.equal(reapplied.tools[0].links[0].applyStatus, 'unchanged');
  assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
});

test('同名真实目录视为冲突，写入时保持原样', (t) => {
  const { home, repo } = makeRepo(t);
  const skillsDir = path.join(home, '.demo', 'skills');
  const userSkill = path.join(skillsDir, 'demo');
  fs.mkdirSync(userSkill, { recursive: true });
  const userFile = path.join(userSkill, 'notes.md');
  fs.writeFileSync(userFile, '用户自己的技能\n', 'utf8');

  const plan = planSkillJunctions(repo, [makeTool({ skillsDir })]);
  assert.equal(plan.summary.conflict, 1);
  assert.equal(plan.tools[0].action, 'ready');
  assert.equal(plan.tools[0].links[0].action, 'conflict');
  assert.match(plan.tools[0].links[0].reason, /不是 junction/);

  const applied = applySkillJunctions(plan);
  assert.equal(applied.ok, true);
  assert.equal(applied.summary.conflict, 1);
  assert.equal(applied.summary.create, 0);
  assert.equal(applied.tools[0].applyStatus, 'skipped');
  assert.equal(fs.readFileSync(userFile, 'utf8'), '用户自己的技能\n');
  assert.equal(fs.lstatSync(userSkill).isSymbolicLink(), false);
});

test('指向其他位置的 junction 视为冲突，不改写链接', (t) => {
  const { home, repo, root } = makeRepo(t);
  const skillsDir = path.join(home, '.demo', 'skills');
  const otherTarget = path.join(root, 'other-skill');
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(otherTarget, { recursive: true });
  const linkPath = path.join(skillsDir, 'demo');
  fs.symlinkSync(otherTarget, linkPath, 'junction');

  const plan = planSkillJunctions(repo, [makeTool({ skillsDir })]);
  assert.equal(plan.summary.conflict, 1);
  assert.equal(plan.tools[0].links[0].action, 'conflict');
  assert.match(plan.tools[0].links[0].reason, /已指向其他位置/);

  applySkillJunctions(plan);
  assert.equal(
    path.resolve(fs.realpathSync(linkPath)),
    path.resolve(fs.realpathSync(otherTarget))
  );
});

test('没有自建技能时所有工具标记 no-skills 且不创建目录', (t) => {
  const { home, repo } = makeRepo(t, []);
  const skillsDir = path.join(home, '.demo', 'skills');

  const plan = planSkillJunctions(repo, [makeTool({ skillsDir })]);
  assert.equal(plan.summary.skills, 0);
  assert.equal(plan.tools[0].action, 'no-skills');

  const applied = applySkillJunctions(plan);
  assert.equal(applied.ok, true);
  assert.equal(applied.tools[0].applyStatus, 'skipped');
  assert.equal(fs.existsSync(skillsDir), false);
});

test('技能目录路径已存在但不是目录时视为冲突', (t) => {
  const { home, repo } = makeRepo(t);
  const skillsDir = path.join(home, '.demo', 'skills');
  fs.mkdirSync(path.dirname(skillsDir), { recursive: true });
  fs.writeFileSync(skillsDir, '不是目录', 'utf8');

  const plan = planSkillJunctions(repo, [makeTool({ skillsDir })]);
  assert.equal(plan.summary.conflict, 1);
  assert.equal(plan.tools[0].action, 'conflict');
  assert.match(plan.tools[0].reason, /不是目录/);

  const applied = applySkillJunctions(plan);
  assert.equal(applied.ok, true);
  assert.equal(applied.tools[0].applyStatus, 'skipped');
  assert.equal(fs.readFileSync(skillsDir, 'utf8'), '不是目录');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProjects } from '../../src/core/lib/projects.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('项目扫描区分非 git 目录与入口未跟踪，并读取已有忽略行', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwb-projects-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const projectsRoot = path.join(root, 'projects');
  const gitProject = path.join(projectsRoot, 'alpha');
  const plainProject = path.join(root, 'plain');
  fs.mkdirSync(gitProject, { recursive: true });
  fs.mkdirSync(plainProject, { recursive: true });
  const init = spawnSync('git', ['init', '--quiet', gitProject], { encoding: 'utf8' });
  if (init.error) throw init.error;
  fs.appendFileSync(path.join(gitProject, '.git', 'info', 'exclude'), '/AGENTS.md\n', 'utf8');

  const machine = {
    paths: { 项目父级: projectsRoot },
    projects: [{ 名称: 'plain', 路径: plainProject }]
  };
  const result = scanProjects({ repoRoot, machine, state: {} });
  const byName = Object.fromEntries(result.projects.map((project) => [project.name, project]));

  assert.equal(byName.alpha.isRepo, true);
  assert.equal(byName.alpha.tracked, false);
  assert.equal(byName.alpha.excludePresent, true);
  assert.equal(byName.alpha.mode, 'auto');
  assert.equal(byName.alpha.status, 'not-mounted');

  assert.equal(byName.plain.isRepo, false);
  assert.equal(byName.plain.tracked, false);
  assert.equal(byName.plain.excludePresent, false);
  assert.equal(byName.plain.status, 'not-mounted');
  assert.equal(byName.plain.mode, 'auto');
});

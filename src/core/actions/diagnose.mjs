import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../lib/fs-safe.mjs';
import { findMachineFile, toPosixPath } from '../lib/paths.mjs';
import { readState } from '../lib/state.mjs';
import { loadTargets } from '../lib/target-registry.mjs';
import { formatLocalIso, formatStamp } from '../lib/time.mjs';
import { writeZip } from '../lib/zip.mjs';
import { run as runDoctor } from './doctor.mjs';
import { run as runLog } from './log.mjs';
import { run as runStatus } from './status.mjs';

const FORMAT_NAME = 'aiwb-diagnose';
const FORMAT_VERSION = 1;
const LOG_LIMIT = 1000;
const FILE_NAMES = ['README.md', 'summary.json', 'status.json', 'doctor.json', 'log.json', 'paths.json'];

/**
 * 生成状态、哈希、日志与路径清单诊断包，可选 zip。
 * @param {{repoRoot: string, hostname?: string, now?: Date}} ctx 运行上下文
 * @param {{zip?: boolean}} [params] 动作参数
 * @param {Array<object>} actions 动作注册表，用于 CLI/GUI 对等性检查
 * @returns {Promise<object>} 诊断包结果
 */
export async function run(ctx, params = {}, actions = []) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const generatedAt = formatLocalIso(now);
  const baseDir = path.join(ctx.repoRoot, 'state', 'diagnostics');
  const destination = uniqueDestination(baseDir, `diagnose-${formatStamp(now)}`);
  fs.mkdirSync(baseDir, { recursive: true });

  const status = await capture(() => runStatus(ctx));
  const log = await capture(() => runLog(ctx, { limit: LOG_LIMIT }));
  const doctor = await capture(() => runDoctor(ctx, {}, actions));
  const targets = await capture(() => loadTargets(ctx.repoRoot, { hostname: ctx.hostname }));
  const state = await capture(() => readState(ctx.repoRoot));

  const paths = buildPaths(ctx, { status, targets, state });
  const summary = buildSummary({
    ctx,
    generatedAt,
    destination,
    status,
    log,
    doctor,
    targets,
    state,
    paths
  });
  const files = [
    { name: 'README.md', content: renderReadme({ generatedAt, ctx, summary }) },
    { name: 'summary.json', content: toJson(summary) },
    { name: 'status.json', content: toJson(sectionPayload(status, generatedAt)) },
    { name: 'doctor.json', content: toJson(sectionPayload(doctor, generatedAt)) },
    { name: 'log.json', content: toJson(sectionPayload(log, generatedAt)) },
    { name: 'paths.json', content: toJson({ generatedAt, ...paths }) }
  ];

  fs.mkdirSync(destination.dir, { recursive: true });
  try {
    for (const file of files) {
      atomicWriteFile(path.join(destination.dir, file.name), file.content, 'utf8');
    }
  } catch (error) {
    cleanupDirectory(destination.dir);
    throw new Error(`诊断包写入失败：${error.message}`);
  }

  const relativeDir = toPosixPath(path.relative(ctx.repoRoot, destination.dir));
  let zip = null;
  if (params.zip === true) {
    try {
      const written = writeZip(
        destination.zipPath,
        files.map((file) => ({ name: `${destination.name}/${file.name}`, data: file.content })),
        { date: now }
      );
      zip = {
        path: toPosixPath(path.relative(ctx.repoRoot, destination.zipPath)),
        bytes: written.bytes,
        entries: written.entries
      };
    } catch (error) {
      throw new Error(
        `诊断目录已写入，但 zip 生成失败：${error.message}（目录：${relativeDir}）`
      );
    }
  }

  return {
    ok: true,
    generatedAt,
    stamp: destination.name,
    outputDir: relativeDir,
    outputPath: destination.dir,
    zip,
    files: files.map((file) => ({
      name: file.name,
      bytes: Buffer.byteLength(file.content, 'utf8')
    })),
    summary,
    health: summary.health,
    issues: summary.issues
  };
}

async function capture(task) {
  try {
    return { ok: true, value: await task() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function sectionPayload(section, generatedAt) {
  if (!section.ok) return { available: false, generatedAt, error: section.error };
  return { available: true, generatedAt, ...section.value };
}

function buildSummary({ ctx, generatedAt, destination, status, log, doctor, targets, state, paths }) {
  const statusValue = status.ok ? status.value : null;
  const logValue = log.ok ? log.value : null;
  const doctorValue = doctor.ok ? doctor.value : null;
  const targetList = targets.ok ? targets.value : [];
  const stateValue = state.ok ? state.value : null;
  const issues = [];

  for (const [section, result] of [
    ['status', status],
    ['log', log],
    ['doctor', doctor],
    ['targets', targets],
    ['state', state]
  ]) {
    if (!result.ok) issues.push({ section, message: result.error });
  }

  const failedChecks = doctorValue
    ? doctorValue.checks
        .filter((check) => check.status === 'fail')
        .map((check) => ({ id: check.id, title: check.title, detail: check.detail }))
    : [];
  for (const check of failedChecks) {
    issues.push({ section: 'doctor', id: check.id, message: check.detail });
  }
  if (logValue && logValue.issues.length > 0) {
    issues.push({ section: 'log', message: `${logValue.issues.length} 行日志无法解析` });
  }
  for (const error of paths.errors) {
    issues.push({ section: 'paths', message: error });
  }

  const health = doctorValue
    ? {
        ok: doctorValue.ok,
        pass: doctorValue.checks.filter((check) => check.status === 'pass').length,
        pending: doctorValue.checks.filter((check) => check.status === 'pending').length,
        fail: failedChecks.length,
        failed: failedChecks
      }
    : { ok: false, error: doctor.error };

  return {
    format: { name: FORMAT_NAME, version: FORMAT_VERSION },
    generatedAt,
    stamp: destination.name,
    machine: { host: ctx.hostname ?? null },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    build: statusValue ? statusValue.build : { error: status.error },
    deploy: statusValue
      ? {
          lastRun: statusValue.state.lastRun,
          recordedTargets: statusValue.state.recordedTargets,
          recordedProjects: statusValue.state.recordedProjects,
          summary: statusValue.summary,
          global: {
            state: statusValue.global.state,
            label: statusValue.global.label,
            reason: statusValue.global.reason
          },
          targets: statusValue.targets.map((target) => ({
            id: target.id,
            state: target.state,
            label: target.label,
            deployedContentHash: target.deployedContentHash,
            entryPath: target.entryPath
          }))
        }
      : { error: status.error },
    health,
    log: logValue
      ? {
          logsDir: logValue.logsDir,
          total: logValue.total,
          shown: logValue.entries.length,
          truncated: logValue.truncated,
          files: logValue.files.length,
          issues: logValue.issues.length
        }
      : { error: log.error },
    state: stateValue
      ? {
          lastRun: stateValue.lastRun,
          targets: Object.keys(stateValue.targets).length,
          projects: Object.keys(stateValue.projects).length
        }
      : { error: state.error },
    targets: {
      total: targetList.length,
      enabled: targetList.filter((tool) => tool.enabled).length,
      installed: targetList.filter((tool) => tool.installed).length,
      custom: targetList.filter((tool) => tool.custom === true).length
    },
    paths: {
      repoRoot: ctx.repoRoot,
      machineFile: paths.machineFile?.path ?? null,
      tools: paths.targets.length,
      projects: paths.projects.length,
      errors: paths.errors.length
    },
    files: FILE_NAMES,
    redactions: [
      '机器档案正文',
      '规则与技能正文',
      '入口文件正文',
      '环境变量值',
      '访问令牌与密钥'
    ],
    issues
  };
}

function buildPaths(ctx, { status, targets, state }) {
  const errors = [];
  let machinePath = status.ok ? status.value.machine.filePath : null;
  if (!machinePath) {
    try {
      machinePath = findMachineFile(ctx.repoRoot, ctx.hostname);
    } catch (error) {
      errors.push(`机器档案路径不可用：${error.message}`);
    }
  }

  const directories = [
    ['content', 'content'],
    ['dist', 'dist'],
    ['state', 'state'],
    ['logs', 'state/logs'],
    ['backups', 'state/backups'],
    ['diagnostics', 'state/diagnostics'],
    ['settingsBackups', 'state/settings-backups']
  ].map(([name, relative]) => {
    const absolute = path.join(ctx.repoRoot, ...relative.split('/'));
    return { name, path: absolute, exists: fs.existsSync(absolute) };
  });

  const tools = targets.ok ? targets.value : [];
  if (!targets.ok) errors.push(`工具路径不可用：${targets.error}`);

  let global = null;
  if (status.ok) {
    const value = status.value.global;
    global = {
      state: value.state,
      label: value.label,
      reason: value.reason,
      globalRoot: value.globalRoot,
      globalRootExists: value.globalRoot ? fs.existsSync(value.globalRoot) : false,
      sourceDir: value.sourceDir ?? null,
      sourceDirExists: value.sourceDir ? fs.existsSync(value.sourceDir) : false,
      linkPath: value.linkPath,
      linkExists: value.linkPath ? fs.existsSync(value.linkPath) : false
    };
  }

  const projects = state.ok
    ? Object.entries(state.value.projects).map(([projectPath, record]) => {
        const fileName =
          typeof record.file === 'string' && path.basename(record.file) === record.file
            ? record.file
            : null;
        const entryPath = fileName ? path.join(projectPath, fileName) : null;
        const excludePath = path.join(projectPath, '.git', 'info', 'exclude');
        return {
          projectPath,
          mode: record.mode ?? null,
          file: fileName,
          entryPath,
          entryExists: entryPath ? fs.existsSync(entryPath) : false,
          excludePath,
          excludeExists: fs.existsSync(excludePath),
          excludeAdded: record.excludeAdded === true,
          attachedAt: record.attachedAt ?? null
        };
      })
    : [];
  if (!state.ok) errors.push(`项目路径不可用：${state.error}`);

  return {
    available: true,
    errors,
    repoRoot: ctx.repoRoot,
    machineFile: machinePath ? { path: machinePath, exists: fs.existsSync(machinePath) } : null,
    directories,
    targets: tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      custom: tool.custom === true,
      enabled: tool.enabled,
      installed: tool.installed,
      entryPath: tool.entryPath,
      entryExists: fs.existsSync(tool.entryPath),
      skillsDir: tool.skillsDir ?? null,
      skillsDirExists: tool.skillsDir ? fs.existsSync(tool.skillsDir) : false
    })),
    global,
    projects
  };
}

function renderReadme({ generatedAt, ctx, summary }) {
  return [
    '# AI 工作台诊断包',
    '',
    `- 生成时间：${generatedAt}`,
    `- 主机：${ctx.hostname ?? '（未知）'}`,
    `- 格式：${FORMAT_NAME} v${FORMAT_VERSION}`,
    `- 包名：${summary.stamp}`,
    '',
    '## 文件',
    '',
    '| 文件 | 内容 |',
    '|---|---|',
    '| README.md | 本说明 |',
    '| summary.json | 状态、哈希、体检与日志的汇总 |',
    '| status.json | 工具入口、全局工作台与构建清单状态 |',
    '| doctor.json | 健康检查逐项结果 |',
    '| log.json | 操作日志、部署记录与项目记录 |',
    '| paths.json | 本机路径与存在性清单 |',
    '',
    '## 隐私与范围',
    '',
    '- 不包含：机器档案正文、规则或技能正文、入口文件正文、环境变量值、访问令牌、密钥。',
    '- 包含：本机路径、主机名、构建哈希、部署状态、操作日志中的动作/目标/结果/备份路径，以及体检结果。',
    '- 诊断包只写入本机 `state/diagnostics/`，不会上传；发给他人前请先检查路径与主机信息。',
    '',
    '## 摘要',
    '',
    `- 体检：${healthSummary(summary.health)}`,
    `- 部署状态：${deploySummary(summary.deploy)}`,
    `- 日志：${logSummary(summary.log)}`,
    `- 路径：工具 ${summary.paths.tools} 个，项目 ${summary.paths.projects} 个`,
    '',
    '## 重新生成',
    '',
    '```powershell',
    'aiwb diagnose --zip',
    '```',
    ''
  ].join('\n');
}

function healthSummary(health) {
  if (health.error) return `不可用（${health.error}）`;
  return `${health.ok ? '通过' : '未通过'}：通过 ${health.pass}，待处理 ${health.pending}，失败 ${health.fail}`;
}

function deploySummary(deploy) {
  if (deploy.error) return `不可用（${deploy.error}）`;
  const summary = deploy.summary;
  return `正常 ${summary.ok}，待更新 ${summary.stale}，漂移 ${summary.drift}，缺失 ${summary.missing}，未部署 ${summary.notDeployed}，未安装 ${summary.notInstalled}，预留 ${summary.disabled}，其他 ${summary.manual}`;
}

function logSummary(log) {
  if (log.error) return `不可用（${log.error}）`;
  return `${log.total} 条${log.truncated ? `，仅包含最近 ${log.shown} 条` : ''}${
    log.issues > 0 ? `，${log.issues} 行无法解析` : ''
  }`;
}

function uniqueDestination(baseDir, stamp) {
  let name = stamp;
  let index = 1;
  while (
    fs.existsSync(path.join(baseDir, name)) ||
    fs.existsSync(path.join(baseDir, `${name}.zip`))
  ) {
    name = `${stamp}-${index}`;
    index += 1;
  }
  return {
    name,
    dir: path.join(baseDir, name),
    zipPath: path.join(baseDir, `${name}.zip`)
  };
}

function cleanupDirectory(directory) {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {
    // 清理失败不覆盖原始写入错误。
  }
}

function toJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

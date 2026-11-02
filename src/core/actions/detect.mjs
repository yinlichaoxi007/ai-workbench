import fs from 'node:fs';
import { loadMachine } from '../lib/machine.mjs';
import { loadTargets } from '../lib/target-registry.mjs';

/**
 * 探测本机机器档案、工具安装状态和入口文件。
 * @param {{repoRoot: string, hostname?: string}} ctx 运行上下文
 * @returns {Promise<object>} 探测结果
 */
export async function run(ctx) {
  const machine = loadMachine(ctx.repoRoot, ctx.hostname);
  const tools = loadTargets(ctx.repoRoot, { hostname: ctx.hostname }).map((tool) => ({
    id: tool.id,
    name: tool.name,
    custom: tool.custom === true,
    status: tool.status,
    enabled: tool.enabled,
    installed: tool.installed,
    version: tool.version ?? null,
    detectedVersion: tool.detectedVersion ?? null,
    versionDetail: tool.versionDetail ?? null,
    versionSource: tool.versionSource ?? null,
    versionCheck: tool.versionCheck ?? null,
    configRoot: tool.configRoot,
    configRootExists: tool.configRootExists,
    entryPath: tool.entryPath,
    entryPrimaryPath: tool.entryPrimaryPath,
    entryExists: fs.existsSync(tool.entryPath),
    usingFallback: tool.usingFallback,
    strategy: tool.entry.strategy,
    format: tool.entry.format,
    skillsDir: tool.skillsDir,
    skillsDirExists: tool.skillsDirExists,
    overrides: tool.overrides,
    notes: tool.notes ?? ''
  }));

  return {
    repoRoot: ctx.repoRoot,
    machine: {
      host: machine.host,
      filePath: machine.filePath,
      projectRoot: machine.paths['项目父级'] ?? null,
      references: machine.paths
    },
    settings: {
      backupRetention: machine.settings.backupRetention,
      guiPort: machine.settings.guiPort,
      env: machine.settings.env,
      tools: Object.keys(machine.settings.tools),
      customTools: Object.keys(machine.settings.customTools),
      issues: machine.settings.issues
    },
    node: process.version,
    tools
  };
}

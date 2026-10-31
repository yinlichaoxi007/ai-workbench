import * as backupAction from './actions/backup.mjs';
import * as buildAction from './actions/build.mjs';
import * as contentAction from './actions/content.mjs';
import * as deployAction from './actions/deploy.mjs';
import * as detectAction from './actions/detect.mjs';
import * as doctorAction from './actions/doctor.mjs';
import * as guiAction from './actions/gui.mjs';
import * as statusAction from './actions/status.mjs';

/**
 * CLI 与 GUI 共用的动作注册表。
 * 新增能力时同时补 cli 与 gui 元数据，doctor --parity 会检查缺项。
 */
export const actions = [
  {
    id: 'detect',
    title: '探测工具与环境',
    description: '列出机器档案、工具安装状态和入口文件',
    cli: { command: 'detect', options: ['--json'], usage: 'aiwb detect [--json]' },
    gui: { page: 'overview', form: [], confirm: false },
    writeScope: 'none',
    dryRun: false,
    run: detectAction.run
  },
  {
    id: 'build',
    title: '生成入口内容',
    description: '从 content/ 与机器档案生成 dist/ENTRY.md 和清单',
    cli: { command: 'build', options: ['--check'], usage: 'aiwb build [--check]' },
    gui: {
      page: 'content',
      form: [{ name: 'check', type: 'boolean', label: '只检查，不写入构建产物' }],
      confirm: false
    },
    writeScope: 'repository',
    dryRun: false,
    run: buildAction.run
  },
  {
    id: 'deploy',
    title: '部署入口与全局工作台',
    description: '预演或执行各工具入口与全局工作台的目录、脚本 junction',
    cli: {
      command: 'deploy',
      options: ['--dry-run', '--apply', '--tool'],
      usage: 'aiwb deploy [--dry-run|--apply] [--tool <id>]'
    },
    gui: {
      page: 'deploy',
      form: [
        { name: 'tool', type: 'select', label: '目标工具', options: 'targets' },
        { name: 'apply', type: 'boolean', label: '执行外部写入（建议先预演）' }
      ],
      confirm: true
    },
    writeScope: 'external',
    dryRun: true,
    run: deployAction.run
  },
  {
    id: 'backup',
    title: '备份查看与恢复',
    description: '列出部署前备份，按备份恢复入口（默认只预演）',
    cli: {
      command: 'backup',
      options: ['--json', '--apply', '--force', '--tool'],
      usage: 'aiwb backup <list|restore> [工具 id] [时间戳] [--apply] [--force]'
    },
    gui: {
      page: 'deploy',
      form: [
        { name: 'subcommand', type: 'select', label: '操作', options: ['list', 'restore'] },
        { name: 'tool', type: 'text', label: '工具 id' },
        { name: 'stamp', type: 'text', label: '备份时间戳' },
        { name: 'apply', type: 'boolean', label: '执行恢复写入' },
        { name: 'force', type: 'boolean', label: '覆盖部署后被修改的入口' }
      ],
      confirm: true
    },
    writeScope: 'external',
    dryRun: true,
    run: backupAction.run
  },
  {
    id: 'content',
    title: '内容维护',
    description: '校验规则与技能，生成新规则或新技能骨架',
    cli: {
      command: 'content',
      options: ['--json', '--dry-run', '--title', '--description'],
      usage: 'aiwb content <lint|new-rule|new-skill> [名称] [--dry-run]'
    },
    gui: {
      page: 'content',
      form: [
        {
          name: 'subcommand',
          type: 'select',
          label: '操作',
          options: ['lint', 'new-rule', 'new-skill']
        },
        { name: 'name', type: 'text', label: '规则 slug 或技能名称' },
        { name: 'title', type: 'text', label: '标题' },
        { name: 'description', type: 'text', label: '技能触发场景' },
        { name: 'dryRun', type: 'boolean', label: '只预演，不写入' }
      ],
      confirm: true
    },
    writeScope: 'repository',
    dryRun: false,
    run: contentAction.run
  },
  {
    id: 'status',
    title: '查看部署状态',
    description: '对比部署状态、入口文件与当前构建清单',
    cli: { command: 'status', options: ['--json'], usage: 'aiwb status [--json]' },
    gui: { page: 'overview', form: [], confirm: false },
    writeScope: 'none',
    dryRun: false,
    run: statusAction.run
  },
  {
    id: 'gui',
    title: '启动本地 GUI',
    description: '在 127.0.0.1 启动只读优先的本地界面，写入需界面确认',
    cli: {
      command: 'gui',
      options: ['--port', '--open', '--json'],
      usage: 'aiwb gui [--port <0-65535>] [--open]'
    },
    gui: { page: 'overview', form: [], confirm: false },
    writeScope: 'none',
    dryRun: false,
    run: guiAction.run
  },
  {
    id: 'doctor',
    title: '健康检查',
    description: '检查环境、构建、注册表、动作对等性和入口漂移',
    cli: {
      command: 'doctor',
      options: ['--parity', '--json'],
      usage: 'aiwb doctor [--parity] [--json]'
    },
    gui: {
      page: 'overview',
      form: [{ name: 'parity', type: 'boolean', label: '只检查 CLI/GUI 元数据对等性' }],
      confirm: false
    },
    writeScope: 'none',
    dryRun: false,
    run: (ctx, params) => doctorAction.run(ctx, params, actions)
  }
];

/**
 * 按 id 查找动作。
 * @param {string} id 动作 id
 * @returns {object|undefined} 动作定义
 */
export function getAction(id) {
  return actions.find((action) => action.id === id);
}

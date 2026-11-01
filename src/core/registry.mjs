import * as backupAction from './actions/backup.mjs';
import * as buildAction from './actions/build.mjs';
import * as contentAction from './actions/content.mjs';
import * as deployAction from './actions/deploy.mjs';
import * as detectAction from './actions/detect.mjs';
import * as diagnoseAction from './actions/diagnose.mjs';
import * as doctorAction from './actions/doctor.mjs';
import * as guiAction from './actions/gui.mjs';
import * as logAction from './actions/log.mjs';
import * as mergeAction from './actions/merge.mjs';
import * as projectAction from './actions/project.mjs';
import * as settingsAction from './actions/settings.mjs';
import * as statusAction from './actions/status.mjs';
import * as uninstallAction from './actions/uninstall.mjs';

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
    id: 'merge',
    title: '合并冲突入口',
    description: '预演或按提交内容改写工作台块，块外原文保持不变；默认只预演',
    cli: {
      command: 'merge',
      options: ['--preview', '--apply', '--content-file', '--json'],
      usage: 'aiwb merge <工具 id> [--preview] [--apply --content-file <路径>]'
    },
    gui: {
      page: 'merge',
      form: [
        { name: 'tool', type: 'select', label: '目标工具', options: 'targets' },
        { name: 'content', type: 'text', label: '合并结果全文' },
        { name: 'apply', type: 'boolean', label: '写入合并结果' }
      ],
      confirm: true
    },
    writeScope: 'external',
    dryRun: true,
    run: mergeAction.run
  },
  {
    id: 'backup',
    title: '备份、清理与恢复',
    description: '主动备份当前入口，列出备份，按保留份数清理旧备份，按备份恢复入口（清理与恢复默认预演）',
    cli: {
      command: 'backup',
      options: ['--json', '--apply', '--force', '--tool', '--keep'],
      usage:
        'aiwb backup <list|create|prune|restore> [工具 id] [时间戳] [--keep <n>] [--apply] [--force]'
    },
    gui: {
      page: 'deploy',
      form: [
        {
          name: 'subcommand',
          type: 'select',
          label: '操作',
          options: ['list', 'create', 'prune', 'restore']
        },
        { name: 'tool', type: 'text', label: '工具 id' },
        { name: 'stamp', type: 'text', label: '备份时间戳' },
        { name: 'keep', type: 'text', label: '每工具保留份数' },
        { name: 'apply', type: 'boolean', label: '执行清理或恢复写入' },
        { name: 'force', type: 'boolean', label: '覆盖部署后被修改的入口' }
      ],
      confirm: true
    },
    writeScope: 'external',
    dryRun: true,
    run: backupAction.run
  },
  {
    id: 'uninstall',
    title: '卸载工作台入口',
    description:
      '移除入口中的工作台块或工作台创建的文件，并清理技能与全局脚本 junction；默认预演，保留备份和用户内容',
    cli: {
      command: 'uninstall',
      options: ['--tool', '--apply', '--force', '--json'],
      usage: 'aiwb uninstall [--tool <id>] [--apply] [--force]'
    },
    gui: {
      page: 'deploy',
      form: [
        { name: 'tool', type: 'select', label: '目标工具', options: 'targets' },
        { name: 'apply', type: 'boolean', label: '执行卸载（建议先预演）' },
        { name: 'force', type: 'boolean', label: '移除与部署记录不一致的块' }
      ],
      confirm: true
    },
    writeScope: 'external',
    dryRun: true,
    run: uninstallAction.run
  },
  {
    id: 'scan',
    title: '扫描项目仓库',
    description: '只读扫描项目父级与机器档案项目清单，列出挂载状态、git 状态和待处理项',
    cli: {
      command: 'scan',
      options: ['--root', '--json'],
      usage: 'aiwb scan [--root <项目父级>] [--json]'
    },
    gui: { page: 'projects', form: [], confirm: false },
    writeScope: 'none',
    dryRun: false,
    run: projectAction.runScan
  },
  {
    id: 'attach',
    title: '挂载项目入口',
    description: '向项目根写入工作台指针块，并按需加入 .git/info/exclude；默认预演',
    cli: {
      command: 'attach',
      options: ['--mode', '--apply', '--dry-run', '--json'],
      usage: 'aiwb attach <项目路径> [--mode auto|local|append] [--apply]'
    },
    gui: {
      page: 'projects',
      form: [
        { name: 'path', type: 'text', label: '项目路径' },
        { name: 'mode', type: 'select', label: '挂载方式', options: ['auto', 'local', 'append'] },
        { name: 'apply', type: 'boolean', label: '执行写入（建议先预演）' }
      ],
      confirm: true
    },
    writeScope: 'external',
    dryRun: true,
    run: projectAction.runAttach
  },
  {
    id: 'detach',
    title: '取消项目挂载',
    description: '移除项目入口中的工作台块，必要时删除工作台创建且已空的文件；默认预演',
    cli: {
      command: 'detach',
      options: ['--apply', '--force', '--json'],
      usage: 'aiwb detach <项目路径> [--apply] [--force]'
    },
    gui: {
      page: 'projects',
      form: [
        { name: 'path', type: 'text', label: '项目路径' },
        { name: 'apply', type: 'boolean', label: '执行移除（建议先预演）' },
        { name: 'force', type: 'boolean', label: '移除没有记录或与记录不一致的块' }
      ],
      confirm: true
    },
    writeScope: 'external',
    dryRun: true,
    run: projectAction.runDetach
  },
  {
    id: 'content',
    title: '内容维护',
    description: '查看、校验并编辑规则与技能，生成新内容后重建构建',
    cli: {
      command: 'content',
      options: [
        '--json',
        '--dry-run',
        '--apply',
        '--build',
        '--title',
        '--description',
        '--content-file',
        '--expected-hash'
      ],
      usage:
        'aiwb content <lint|list|read|save|new-rule|new-skill> [类型] [名称] [--content-file <路径>] [--apply] [--build]'
    },
    gui: {
      page: 'content',
      form: [
        {
          name: 'subcommand',
          type: 'select',
          label: '操作',
          options: ['lint', 'list', 'read', 'save', 'new-rule', 'new-skill']
        },
        { name: 'name', type: 'text', label: '规则或技能名称' },
        { name: 'title', type: 'text', label: '标题' },
        { name: 'description', type: 'text', label: '技能触发场景' },
        { name: 'apply', type: 'boolean', label: '保存内容' },
        { name: 'build', type: 'boolean', label: '写入后重建构建' }
      ],
      confirm: true
    },
    writeScope: 'repository',
    dryRun: false,
    run: contentAction.run
  },
  {
    id: 'settings',
    title: '查看与修改设置',
    description:
      '查看并修改机器档案中的备份保留、GUI 端口、环境变量、工具路径覆盖和自定义工具；默认只预演',
    cli: {
      command: 'settings',
      options: ['--json', '--apply', '--force', '--expected-hash'],
      usage:
        'aiwb settings <show|set|unset> [设置项[=值] ...] [--apply] [--expected-hash <哈希>]'
    },
    gui: {
      page: 'settings',
      form: [
        { name: 'changes', type: 'object', label: '设置项与值（null 表示删除）' },
        { name: 'expectedFileHash', type: 'text', label: '预演时的文件哈希' },
        { name: 'apply', type: 'boolean', label: '写入机器档案' }
      ],
      confirm: true
    },
    writeScope: 'repository',
    dryRun: true,
    run: settingsAction.run
  },
  {
    id: 'log',
    title: '查看操作历史',
    description: '读取本机操作日志与部署记录，按写入顺序倒序显示；只读，不修改文件',
    cli: {
      command: 'log',
      options: ['--limit', '--json'],
      usage: 'aiwb log [--limit <n>] [--json]'
    },
    gui: {
      page: 'history',
      form: [{ name: 'limit', type: 'text', label: '显示条数' }],
      confirm: false
    },
    writeScope: 'none',
    dryRun: false,
    run: logAction.run
  },
  {
    id: 'diagnose',
    title: '生成诊断包',
    description:
      '汇总部署状态、构建与入口哈希、操作日志和路径清单到 state/diagnostics，可选 zip；不读取机器档案正文、环境变量值与内容正文',
    cli: {
      command: 'diagnose',
      options: ['--zip', '--json'],
      usage: 'aiwb diagnose [--zip] [--json]'
    },
    gui: {
      page: 'diagnose',
      form: [{ name: 'zip', type: 'boolean', label: '生成 zip 压缩包' }],
      confirm: true
    },
    writeScope: 'repository',
    dryRun: false,
    run: (ctx, params) => diagnoseAction.run(ctx, params, actions)
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

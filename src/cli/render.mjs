const WIDE_CHAR = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/**
 * 计算终端显示宽度，中文和全角字符按 2 列计。
 * @param {string} text 文本
 * @returns {number} 显示宽度
 */
export function displayWidth(text) {
  let width = 0;
  for (const char of String(text)) {
    const code = char.codePointAt(0);
    width += WIDE_CHAR.test(char) || code >= 0x20000 ? 2 : 1;
  }
  return width;
}

/**
 * 按显示宽度右侧补空格。
 * @param {string} text 文本
 * @param {number} width 目标宽度
 * @returns {string} 补齐后的文本
 */
export function pad(text, width) {
  return `${text}${' '.repeat(Math.max(0, width - displayWidth(text)))}`;
}

/**
 * 渲染简单文本表格。
 * @param {string[]} headers 表头
 * @param {Array<Array<string|number|boolean|null>>} rows 数据行
 * @returns {string} 表格文本
 */
export function table(headers, rows) {
  const allRows = [headers, ...rows.map((row) => row.map((cell) => (cell ?? '').toString()))];
  const widths = headers.map((_, index) =>
    Math.max(...allRows.map((row) => displayWidth(row[index] ?? '')))
  );
  const formatRow = (row) =>
    row
      .map((cell, index) => pad((cell ?? '').toString(), widths[index]))
      .join('  ')
      .trimEnd();

  return [
    formatRow(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(formatRow)
  ].join('\n');
}

export function renderBuild(result) {
  if (result.mode === 'check') {
    return [
      '构建检查',
      `  结果：${result.current ? '已是最新' : '需要重新构建'}`,
      `  当前内容哈希：${result.contentHash}`,
      `  清单内容哈希：${result.manifestContentHash ?? '（无清单）'}`,
      `  入口产物：${result.entryExists ? '存在' : '缺失'}`,
      result.error ? `  错误：${result.error}` : null
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    '构建完成',
    `  机器：${result.machine.host}`,
    `  内容哈希：${result.contentHash}`,
    `  块哈希：${result.blockHash}`,
    `  生成时间：${result.generatedAt}`,
    `  入口产物：${result.entryPath}`,
    `  构建清单：${result.manifestPath}`,
    `  源文件：${result.sources.length} 个`,
    `  技能：${result.skills.length} 个`
  ].join('\n');
}

export function renderDetect(result) {
  const rows = result.tools.map((tool) => [
    tool.name,
    tool.status,
    tool.enabled ? '是' : '否（预留）',
    tool.installed ? '是' : '否',
    tool.strategy === 'block-append' ? '追加块' : '独立文件',
    tool.entryPath,
    tool.entryExists ? (tool.usingFallback ? '是（备选路径）' : '是') : '否',
    tool.skillsDirExists ? '存在' : '无'
  ]);

  return [
    'AI 工作台 · 环境探测',
    `  仓库：${result.repoRoot}`,
    `  机器：${result.machine.host}（${result.machine.filePath}）`,
    `  项目父级：${result.machine.projectRoot ?? '（未配置）'}`,
    `  Node：${result.node}`,
    '',
    table(['工具', '证据', '启用', '安装', '写入方式', '入口', '入口存在', '技能目录'], rows)
  ].join('\n');
}

export function renderContent(result) {
  if (result.subcommand === 'lint') {
    const lines = [
      '内容校验',
      `  规则：${result.rules.length} 条；技能：${result.skills.length} 个`
    ];

    for (const error of result.errors) {
      lines.push(`  [错误] ${formatIssue(error)}`);
    }
    for (const warning of result.warnings) {
      lines.push(`  [提醒] ${formatIssue(warning)}`);
    }

    lines.push('', `结果：${result.ok ? '通过' : '未通过'}`);
    return lines.join('\n');
  }

  const lines = [
    result.dryRun ? '内容创建预演（不会写入文件）' : '内容已创建',
    `  文件：${result.file}`
  ];

  if (result.subcommand === 'new-rule') {
    const prefix = result.dryRun ? '将' : '已';
    lines.push(
      `  索引：${result.readingOrderUpdated ? `${prefix}登记阅读顺序` : '未找到阅读顺序'}；${
        result.dutyTableUpdated ? `${prefix}补文件职责表` : '未找到文件职责表'
      }`
    );
  }

  if (result.dryRun) {
    lines.push('', '预览内容：', result.content.trim());
  }

  return lines.join('\n');
}

function formatIssue(issue) {
  return `${issue.file}：${issue.message}`;
}

export function renderDeploy(result) {
  const rows = result.targets.map((target) => [
    target.name,
    actionLabel(target.action),
    target.reason,
    target.entryPath
  ]);

  const lines = [
    '部署预演（不会写入任何文件）',
    `  机器：${result.machine.host}`,
    `  构建：${result.build.contentHash}${result.build.rebuilt ? '（已刷新构建产物）' : '（使用现有构建产物）'}`,
    `  状态记录：${result.state.recordedTargets} 个目标${result.state.lastRun ? `，上次 ${result.state.lastRun}` : ''}`,
    '',
    table(['工具', '动作', '说明', '入口'], rows),
    '',
    `汇总：${summaryLabel(result.summary)}`
  ];

  const manual = result.targets.filter((target) => target.action === 'manual');
  if (manual.length > 0) {
    lines.push('', '需人工处理：');
    for (const target of manual) {
      lines.push(`  - ${target.name}：${target.reason}（${target.entryPath}）`);
    }
  }

  return lines.join('\n');
}

export function renderStatus(result) {
  const rows = result.targets.map((target) => [
    target.name,
    target.label,
    target.recorded ? '有' : '无',
    target.entryPath
  ]);

  const lines = [
    '部署状态',
    `  机器：${result.machine.host}（${result.machine.filePath}）`,
    `  构建清单：${result.build.contentHash ?? '（无）'}${result.build.generatedAt ? `，生成于 ${result.build.generatedAt}` : ''}`,
    `  状态记录：${result.state.recordedTargets} 个目标${result.state.lastRun ? `，上次 ${result.state.lastRun}` : ''}`,
    result.build.error ? `  构建清单错误：${result.build.error}` : null,
    '',
    table(['工具', '状态', '记录', '入口'], rows),
    '',
    `汇总：正常 ${result.summary.ok}，待更新 ${result.summary.stale}，漂移 ${result.summary.drift}，缺失 ${result.summary.missing}，未部署 ${result.summary.notDeployed}，未安装 ${result.summary.notInstalled}，预留 ${result.summary.disabled}，其他 ${result.summary.manual}`
  ];

  return lines.filter((line) => line !== null).join('\n');
}

export function renderDoctor(result) {
  const statusLabel = { pass: '[通过]', fail: '[失败]', pending: '[待实现]' };
  const lines = ['健康检查'];

  for (const check of result.checks) {
    lines.push(`  ${statusLabel[check.status] ?? '[未知]'} ${check.title}：${check.detail}`);
  }

  lines.push('', `结果：${result.ok ? '通过' : '未通过'}`);
  return lines.join('\n');
}

export function renderHelp(actions) {
  const rows = actions.map((action) => [
    action.cli.command,
    action.title,
    action.cli.usage
  ]);

  return [
    'AI 工作台（aiwb）',
    '用法：aiwb <命令> [选项]',
    '',
    table(['命令', '作用', '用法'], rows),
    '',
    '通用选项：--json 输出 JSON；--help 查看帮助；--version 查看版本',
    '当前阶段：deploy 只做预演，不写外部文件；GUI 将在 P2 实现。'
  ].join('\n');
}

function actionLabel(action) {
  return (
    {
      'create-file': '新建文件',
      'append-block': '追加块',
      'update-block': '更新块',
      unchanged: '无需变更',
      manual: '需人工',
      'skip-not-installed': '未安装',
      'skip-unsupported': '不接入',
      'skip-disabled': '预留'
    }[action] ?? action
  );
}

function summaryLabel(summary) {
  return [
    `新建 ${summary.create}`,
    `追加 ${summary.append}`,
    `更新 ${summary.update}`,
    `无变化 ${summary.unchanged}`,
    `需人工 ${summary.manual}`,
    `跳过 ${summary.skipped}`
  ].join('，');
}

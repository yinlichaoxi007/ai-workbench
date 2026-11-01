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

  if (result.subcommand === 'list') {
    const lines = [
      '内容清单',
      `  规则：${result.rules.length} 条；技能：${result.skills.length} 个`,
      ''
    ];
    for (const rule of result.rules) {
      const marks = [
        rule.isIndex ? '索引' : null,
        rule.indexed ? null : '未登记索引'
      ].filter(Boolean);
      lines.push(
        `  [规则] ${rule.file}${marks.length > 0 ? `（${marks.join('，')}）` : ''} - ${rule.title}`
      );
    }
    for (const skill of result.skills) {
      lines.push(
        `  [技能] ${skill.file}${skill.builtin ? '（内置）' : ''} - ${skill.title}`
      );
    }
    return lines.join('\n');
  }

  if (result.subcommand === 'read') {
    return [
      '内容正文',
      `  文件：${result.file}`,
      `  哈希：${result.fileHash}`,
      '',
      result.content.trimEnd()
    ].join('\n');
  }

  if (result.subcommand === 'save') {
    const labels = {
      preview: '预演通过，确认后保存',
      unchanged: '内容无变化',
      blocked: '未保存',
      applied: '已保存'
    };
    const lines = [
      `内容保存：${labels[result.status] ?? result.status}`,
      `  文件：${result.file}`,
      `  哈希：${result.fileHash}${result.nextHash ? ` → ${result.nextHash}` : ''}`
    ];
    for (const error of result.lint?.errors ?? []) {
      lines.push(`  [错误] ${formatIssue(error)}`);
    }
    for (const warning of result.lint?.warnings ?? []) {
      lines.push(`  [提醒] ${formatIssue(warning)}`);
    }
    if (result.build) {
      lines.push(`  构建：${result.build.contentHash}（已重建 ${result.build.entry}）`);
    }
    lines.push('', `结果：${result.reason}`);
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

  if (result.build) {
    lines.push(`  构建：${result.build.contentHash}（已重建 ${result.build.entry}）`);
  }

  return lines.join('\n');
}

function formatIssue(issue) {
  return `${issue.file}：${issue.message}`;
}

export function renderDeploy(result) {
  const showApply = !result.dryRun;
  const headers = showApply
    ? ['工具', '动作', '结果', '说明', '入口']
    : ['工具', '动作', '说明', '入口'];
  const rows = result.targets.map((target) =>
    showApply
      ? [
          target.name,
          actionLabel(target.action),
          applyStatusLabel(target.applyStatus),
          target.reason,
          target.entryPath
        ]
      : [target.name, actionLabel(target.action), target.reason, target.entryPath]
  );

  const lines = [
    result.dryRun ? '部署预演（不会写入任何文件）' : result.applied ? '部署已执行' : '部署未完成',
    `  机器：${result.machine.host}`,
    `  构建：${result.build.contentHash}${result.build.rebuilt ? '（已刷新构建产物）' : '（使用现有构建产物）'}`,
    `  状态记录：${result.state.recordedTargets} 个目标${result.state.lastRun ? `，上次 ${result.state.lastRun}` : ''}`
  ];

  if (result.global) {
    lines.push('', ...renderGlobal(result.global));
  } else {
    lines.push('', '全局工作台：本次指定了 --tool，跳过全局工作台检查');
  }

  lines.push('', table(headers, rows), '');
  lines.push(...renderSkills(result.skills, showApply), '');

  if (showApply) {
    if (result.apply?.failure) {
      lines.push(`失败：${result.apply.failure.name}：${result.apply.failure.error}`);
    } else if (result.apply?.reason) {
      lines.push(`执行结果：${result.apply.reason}`);
    }
    if (result.apply) {
      lines.push(
        `写入 ${result.apply.written}，无变化 ${result.apply.unchanged}，跳过 ${result.apply.skipped}，失败 ${result.apply.failed}`
      );
    }
  } else {
    lines.push(`汇总：${summaryLabel(result.summary)}`);
  }

  const manual = result.targets.filter((target) => target.action === 'manual');
  if (manual.length > 0) {
    lines.push('', '需人工处理：');
    for (const target of manual) {
      lines.push(`  - ${target.name}：${target.reason}（${target.entryPath}）`);
    }
  }

  return lines.join('\n');
}

export function renderMerge(result) {
  const statusLabel = { ready: '可写入', blocked: '已阻止', written: '已写入' };
  const blockLabel = {
    present: '已存在工作台块',
    absent: '没有工作台块',
    malformed: '块标记异常',
    unsupported: '无法读取'
  };
  const lines = [
    result.applied ? '合并已写入' : '合并预演（不会写入任何文件）',
    `  工具：${result.tool.name}（${result.tool.id}）`,
    `  入口：${result.entry.path}${result.entry.exists ? '' : '（不存在）'}`,
    `  方式：${result.tool.strategy === 'separate-file' ? '独立文件' : '追加块'}`,
    `  当前块：${blockLabel[result.entry.blockStatus] ?? result.entry.blockStatus}${
      result.entry.blockReason ? `（${result.entry.blockReason}）` : ''
    }`,
    `  工作台块哈希：${result.workbench.blockHash}`,
    result.entry.currentBlockHash ? `  当前块哈希：${result.entry.currentBlockHash}` : null,
    result.entry.storedBlockHash
      ? `  部署记录块哈希：${result.entry.storedBlockHash}`
      : '  部署记录：无',
    result.entry.modifiedSinceDeploy
      ? '  状态：当前块与部署记录不一致，保存后会更新记录'
      : null,
    `  结果：${statusLabel[result.status] ?? result.status}；${result.reason}`
  ].filter(Boolean);

  for (const warning of result.warnings) lines.push(`  [提醒] ${warning}`);
  for (const issue of result.issues) lines.push(`  [阻止] ${issue.message}`);

  if (result.validation) {
    lines.push(
      '',
      result.validation.ok
        ? '校验：通过；仅工作台块正文变化，块外原文保持原样。'
        : `校验：未通过（${result.validation.issues
            .map((issue) => issue.message)
            .join('；')}）`
    );
  }
  if (result.merged) {
    lines.push(`  写入后文件哈希：${result.merged.fileHash}`);
    lines.push(`  备份：${result.backup ?? '（原文件不存在，无需备份）'}`);
  }
  if (result.dryRun && result.canApply) {
    lines.push('', '  --json 输出中的 suggested 是可编辑的完整合并结果。');
    lines.push(`  写入：aiwb merge ${result.tool.id} --apply --content-file <路径>`);
  } else if (result.dryRun) {
    lines.push('', '  当前状态下不会写入；按上面的阻止原因处理后重新预演。');
  }

  return lines.join('\n');
}

export function renderBackup(result) {
  if (result.subcommand === 'list') {
    const lines = [
      '备份列表',
      `  范围：${result.tool ?? '全部工具'}；共 ${result.backups.length} 份`
    ];

    if (result.backups.length === 0) {
      lines.push('', '  暂无备份。');
    } else {
      const rows = result.backups.map((backup) => [
        backup.toolName,
        backup.backedUpAt,
        backup.action,
        backup.entryPath,
        backup.stamp,
        backup.backupFileExists ? '完整' : '缺文件'
      ]);
      lines.push('', table(['工具', '备份时间', '动作', '入口', '时间戳', '文件'], rows));
    }

    if (result.invalid.length > 0) {
      lines.push('', '不可用的备份记录：');
      for (const item of result.invalid) {
        lines.push(`  [不可用] ${item.relativeDir}：${item.error}`);
      }
    }
    return lines.join('\n');
  }

  if (result.subcommand === 'create') {
    const statusLabel = {
      created: '已创建',
      missing: '无入口',
      failed: '失败'
    };
    const lines = [
      '备份创建',
      `  范围：${result.tool ?? '全部工具'}；已创建 ${result.summary.created}，无入口 ${result.summary.missing}，失败 ${result.summary.failed}`
    ];

    if (result.summary.created === 0 && result.summary.failed === 0) {
      lines.push('', '  没有找到可备份的入口文件。');
    } else {
      const rows = result.tools.map((tool) => [
        tool.name,
        statusLabel[tool.status] ?? tool.status,
        tool.entryPath,
        tool.backup ?? '—',
        tool.reason ?? ''
      ]);
      lines.push('', table(['工具', '结果', '入口', '备份', '说明'], rows));
    }

    if (result.summary.failed > 0) {
      lines.push('', '  存在失败项，请修复后重试。');
    } else if (result.summary.created > 0) {
      lines.push('', '  备份已写入 state/backups/，可用 backup restore 恢复。');
    }
    return lines.join('\n');
  }

  if (result.subcommand === 'prune') {
    const statusLabel = {
      delete: '将删除',
      deleted: '已删除',
      skipped: '跳过',
      failed: '失败'
    };
    const sourceLabel = {
      option: '--keep',
      machine: '机器档案',
      default: '默认'
    };
    const summary = result.summary;
    const lines = [
      result.dryRun ? '备份清理预演（不会删除任何文件）' : '备份清理执行',
      `  范围：${result.tool ?? '全部工具'}；每工具保留最近 ${result.keep} 份（${sourceLabel[result.keepSource] ?? result.keepSource}）`,
      `  汇总：共 ${summary.total} 份，保留 ${summary.kept}，${
        result.dryRun ? `将删除 ${summary.delete}` : `删除 ${summary.deleted}`
      }，跳过 ${summary.skipped}，失败 ${summary.failed}`
    ];

    const rows = result.items
      .filter((item) => item.status !== 'keep')
      .map((item) => [
        item.toolName,
        item.stamp,
        item.relativeDir,
        statusLabel[item.status] ?? item.status,
        item.reason
      ]);

    if (rows.length === 0) {
      lines.push('', '  没有需要清理的备份。');
    } else {
      lines.push('', table(['工具', '时间戳', '备份', '结果', '说明'], rows));
    }

    if (result.dryRun && summary.delete > 0) {
      lines.push('', '  加 --apply 执行清理；每工具最近一份始终保留。');
    }
    if (summary.failed > 0) {
      lines.push('', '  存在删除失败项，请检查权限后重试。');
    }
    return lines.join('\n');
  }

  const statusLabel = {
    restore: '可恢复',
    restored: '已恢复',
    unchanged: '无需恢复',
    blocked: '已阻止'
  };
  const lines = [
    result.dryRun ? '备份恢复预演（不会写入任何文件）' : '备份恢复执行',
    `  工具：${result.tool.name}（${result.tool.id}）`,
    `  时间戳：${result.stamp}`,
    `  入口：${result.entryPath}`,
    `  备份：${result.backupFile}（${result.backupHash}）`,
    `  当前：${result.currentHash ?? '（入口不存在）'}`,
    result.storedHash ? `  部署记录：${result.storedHash}` : '  部署记录：无',
    '',
    `结果：${statusLabel[result.status] ?? result.status}；${result.reason}`
  ];

  if (result.status === 'restore') {
    lines.push('  加 --apply 执行恢复；恢复前会先把当前入口备份一份。');
  }
  if (result.safetyBackup) {
    lines.push(`  恢复前备份：${result.safetyBackup}`);
  }
  return lines.join('\n');
}

export function renderUninstall(result) {
  const entryStatusLabel = {
    'delete-file': result.dryRun ? '将删除文件' : '已删除文件',
    'remove-block': result.dryRun ? '将移除块' : '已移除块',
    absent: '无需处理',
    blocked: '已阻止',
    failed: '失败',
    aborted: '未执行'
  };
  const skillLabel = {
    'remove-junction': result.dryRun ? '将移除' : '已移除',
    removed: '已移除',
    conflict: '冲突',
    absent: '无链接',
    skipped: '跳过',
    failed: '失败',
    aborted: '未执行'
  };
  const globalLabel = {
    'remove-junction': result.dryRun ? '将移除脚本 junction' : '已移除脚本 junction',
    removed: '已移除脚本 junction',
    absent: '无需处理',
    conflict: '冲突',
    unconfigured: '未配置',
    skipped: '跳过',
    failed: '失败',
    aborted: '未执行'
  };
  const summary = result.summary;
  const lines = [
    result.dryRun ? '卸载预演（不会删除任何文件）' : '卸载已执行',
    `  范围：${result.scope.tool ?? '全部工具'}${result.scope.force ? '；--force' : ''}`,
    `  入口：删除文件 ${summary.deleteFile}，移除块 ${summary.removeBlock}，无需处理 ${summary.absent}，已阻止 ${summary.blocked}${
      result.dryRun ? '' : `，已删除 ${summary.deleted}，已移除块 ${summary.blocksRemoved}，失败 ${summary.failed}`
    }`,
    `  技能 junction：${result.dryRun ? `将移除 ${summary.skillsRemove}` : `已移除 ${summary.skillsRemoved}`}，冲突 ${summary.skillsConflict}，失败 ${summary.skillsFailed}`
  ];

  if (result.global) {
    lines.push(`  全局脚本 junction：${globalLabel[result.global.applyStatus ?? result.global.status] ?? result.global.status}`);
  } else {
    lines.push('  全局脚本 junction：本次指定了 --tool，不处理全局工作台');
  }

  const entries = result.targets.filter((target) => target.status !== 'absent');
  if (entries.length === 0) {
    lines.push('', '  没有需要卸载的入口。');
  } else {
    const rows = entries.map((target) => [
      target.name,
      entryStatusLabel[target.applyStatus ?? target.status] ?? target.status,
      target.reason,
      target.entryPath
    ]);
    lines.push('', table(['工具', '动作', '说明', '入口'], rows));
  }

  const links = result.skills.tools.flatMap((tool) =>
    tool.links
      .filter((link) => ['remove-junction', 'conflict', 'failed'].includes(link.action) || link.applyStatus === 'failed' || link.applyStatus === 'removed')
      .map((link) => [tool.name, link.skill, skillLabel[link.applyStatus ?? link.action] ?? link.action, `${link.path} → ${link.currentTarget ?? link.target}`])
  );
  if (links.length > 0) {
    lines.push('', table(['工具', '技能', '动作', '路径'], links));
  }

  if (result.global) {
    const global = result.global;
    lines.push(
      '',
      `全局工作台：${globalLabel[global.applyStatus ?? global.status] ?? global.status}`,
      `  根目录：${global.globalRoot ?? '（未知）'}`,
      global.path ? `  脚本入口：${global.path}` : null,
      global.target ? `    目标：${global.target}` : null,
      global.currentTarget && global.status === 'conflict' ? `    当前指向：${global.currentTarget}` : null,
      global.error ? `    错误：${global.error}` : null,
      global.reason ? `    说明：${global.reason}` : null
    );
  }

  const backups = result.targets.filter((target) => target.backup).map((target) => `${target.name}：${target.backup}`);
  if (backups.length > 0) {
    lines.push('', '卸载前备份：');
    for (const backup of backups) lines.push(`  - ${backup}`);
  }

  if (result.dryRun && summary.deleteFile + summary.removeBlock + summary.skillsRemove + summary.globalRemove > 0) {
    lines.push('', '  加 --apply 执行卸载；每个入口在修改或删除前都会先备份。');
  }
  if (summary.blocked > 0) {
    const canForce = result.targets.some((target) => target.status === 'blocked' && target.canForce);
    lines.push(
      '',
      canForce
        ? '  存在没有部署记录或与记录不一致的块；核对内容后可加 --force 重试。'
        : '  存在需人工处理的入口，本次不会改动。'
    );
  }
  if (result.apply?.reason) {
    lines.push('', `执行结果：${result.apply.reason}`);
  }
  return lines.filter((line) => line !== null).join('\n');
}

export function renderProjectScan(result) {
  const summary = result.summary;
  const lines = [
    '项目扫描',
    `  机器：${result.machine.host}（${result.machine.filePath}）`,
    `  来源：${result.source === 'option' ? '--root 指定' : '机器档案'}`,
    `  项目父级：${result.roots.length > 0 ? result.roots.join('；') : '（未配置）'}`,
    `  构建产物：${result.buildExists ? '存在' : '缺失，挂载前先运行 aiwb build'}`,
    `  汇总：共 ${summary.total}，已挂载 ${summary.mounted}，指针待更新 ${summary.stale}，块被手改 ${summary.drift}，块缺失 ${summary.missingBlock}，入口缺失 ${summary.missingEntry}，有块无记录 ${summary.unmanaged}，入口已跟踪 ${summary.tracked}，未挂载 ${summary.notMounted}，目录缺失 ${summary.missing}，块标记异常 ${summary.malformed}，编码不支持 ${summary.unsupported}`
  ];

  for (const warning of result.warnings) {
    lines.push(`  [提醒] ${warning}`);
  }

  if (result.projects.length === 0) {
    lines.push('', '  没有扫描到项目仓库。检查机器档案的“项目父级”，或用 --root 指定。');
    return lines.join('\n');
  }

  const rows = result.projects.map((project) => [
    project.name,
    project.label,
    project.file ?? '',
    project.recorded ? '有' : '无',
    project.isRepo ? (project.gitWarning ? '工作树/子模块' : '是') : '否',
    project.tracked === true ? '已跟踪' : project.tracked === false ? '未跟踪' : '未知',
    project.isRepo ? (project.excludePresent ? '已忽略' : '未忽略') : '不适用',
    project.path
  ]);
  lines.push(
    '',
    table(['项目', '状态', '入口', '记录', 'Git 仓库', '入口跟踪', '本地忽略', '路径'], rows),
    '',
    '  说明：Git 仓库指项目自身是否为 git 工作区；“入口跟踪”指入口文件是否在 git 索引中；“本地忽略”指 .git/info/exclude 是否含入口行，只在本机生效，不会提交，也不改 .gitignore。'
  );
  return lines.join('\n');
}

export function renderProjectAttach(result) {
  const plan = result.project;
  const attachmentLabel = {
    'create-file': result.dryRun ? '将新建文件' : '已新建文件',
    'append-block': result.dryRun ? '将追加块' : '已追加块',
    'update-block': result.dryRun ? '将更新块' : '已更新块',
    unchanged: '无需变更',
    created: '已新建文件',
    appended: '已追加块',
    updated: '已更新块',
    blocked: '已阻止',
    failed: '失败'
  };
  const status = plan.applyStatus ?? plan.action;
  const lines = [
    result.dryRun ? '项目挂载预演（不会写入文件）' : '项目挂载已执行',
    `  项目：${plan.name}（${plan.projectPath}）`,
    `  方式：${plan.mode}（${plan.file}）`,
    `  动作：${attachmentLabel[status] ?? status}`,
    `  说明：${plan.reason ?? '入口已是最新'}`,
    `  Git 仓库：${plan.git?.isRepo ? (plan.git.warning ? '工作树/子模块' : '是') : '否'}`,
    `  入口跟踪：${plan.tracked === true ? '已跟踪' : plan.tracked === false ? '未跟踪' : '未知'}`
  ];

  if (plan.exclude) {
    const excludeLabel = {
      add: result.dryRun ? '将写入忽略行（仅本机生效）' : '已写入忽略行（仅本机生效）',
      added: '已写入忽略行（仅本机生效）',
      unchanged: '忽略行已存在',
      skip: `跳过（${plan.exclude.reason}）`,
      none: `无需处理（${plan.exclude.reason}）`
    };
    lines.push(
      `  本地忽略（.git/info/exclude）：${excludeLabel[plan.exclude.action] ?? plan.exclude.action}`
    );
  }

  if (plan.backup || result.apply?.backup) {
    lines.push(`  备份：${plan.backup ?? result.apply.backup}`);
  }
  if (plan.error) lines.push(`  错误：${plan.error}`);
  if (result.apply?.reason) lines.push('', `执行结果：${result.apply.reason}`);
  if (result.dryRun && plan.canApply) {
    lines.push('', '  加 --apply 写入；写入前会备份现有入口。');
  }
  if (result.dryRun && plan.status === 'blocked' && plan.reason) {
    lines.push('', '  当前状态下不会写入；请按说明处理后重试。');
  }
  return lines.join('\n');
}

export function renderProjectDetach(result) {
  const plan = result.project;
  const detachLabel = {
    'remove-block': result.dryRun ? '将移除块' : '已移除块',
    'delete-file': result.dryRun ? '将删除文件' : '已删除文件',
    'removed-block': '已移除块',
    deleted: '已删除文件',
    absent: '无需处理',
    blocked: '已阻止',
    failed: '失败'
  };
  const status = plan.applyStatus ?? plan.status;
  const lines = [
    result.dryRun ? '取消挂载预演（不会改动文件）' : '取消挂载已执行',
    `  项目：${plan.name}（${plan.projectPath}）`,
    `  入口：${plan.targetPath ?? '（没有匹配的入口）'}`,
    `  动作：${detachLabel[status] ?? status}${result.force ? '；--force' : ''}`,
    `  说明：${plan.reason ?? '没有需要处理的内容'}`
  ];

  if (plan.exclude) {
    const excludeLabel = {
      remove: result.dryRun ? '将移除忽略行' : '已移除忽略行',
      removed: '已移除忽略行',
      unchanged: '忽略行已不存在',
      none: `无需处理（${plan.exclude.reason}）`
    };
    lines.push(
      `  本地忽略（.git/info/exclude）：${excludeLabel[plan.exclude.action] ?? plan.exclude.action}`
    );
  }

  if (plan.backup) lines.push(`  备份：${plan.backup}`);
  if (result.apply?.reason) lines.push('', `执行结果：${result.apply.reason}`);
  if (result.dryRun && plan.canForce && !plan.canApply) {
    lines.push('', '  核对块内容后可加 --force 重试；--force 只移除块，不删除文件。');
  }
  if (result.dryRun && plan.canApply) {
    lines.push('', '  加 --apply 执行；改动前会备份现有入口。');
  }
  return lines.join('\n');
}

function renderGlobal(global) {
  const lines = [
    '全局工作台：',
    `  根目录：${global.globalRoot}`
  ];

  for (const dir of global.dirs) {
    lines.push(`  ${globalActionLabel(dir.action)} ${dir.name}/：${dir.path}`);
  }

  lines.push(`  ${globalActionLabel(global.link.action)} 脚本入口：${global.link.path}`);
  lines.push(`    目标：${global.link.target}`);
  if (global.link.currentTarget && global.link.action === 'conflict') {
    lines.push(`    当前指向：${global.link.currentTarget}`);
  }
  if (!global.ok) {
    lines.push('  注意：存在冲突，--apply 不会写入任何文件。');
  }
  return lines;
}

function renderSkills(skills, applied) {
  if (!skills) return ['技能 junction：本次未规划'];

  const lines = ['技能 junction：', `  源目录：${skills.sourceDir}`];
  if (skills.skills.length === 0) {
    lines.push('  技能：暂无自建技能');
    return lines;
  }
  lines.push(`  技能：${skills.skills.map((skill) => skill.name).join('、')}`);
  if (skills.aborted) {
    lines.push('  本次未执行：入口写入失败或全局工作台冲突。');
  }

  for (const tool of skills.tools) {
    if (tool.links.length === 0) {
      const status = applied ? (tool.applyStatus ?? tool.action) : tool.action;
      lines.push(`  ${skillStatusLabel(status)} ${tool.name}：${tool.reason}`);
      continue;
    }

    for (const link of tool.links) {
      const status = applied ? (link.applyStatus ?? link.action) : link.action;
      const note = applied ? (link.error ?? link.reason) : link.reason;
      const showNote = ['conflict', 'failed', 'skipped', 'aborted'].includes(status);
      lines.push(
        `  ${skillStatusLabel(status)} ${tool.name} · ${link.skill}：${link.path} → ${link.target}${
          showNote && note ? `（${note}）` : ''
        }`
      );
    }
  }

  const summary = skills.summary;
  lines.push(
    `  汇总：${skills.applied ? '已创建' : '新建'} ${summary.create}，无变化 ${summary.unchanged}，冲突 ${summary.conflict}，跳过 ${summary.skipped}，失败 ${summary.failed}`
  );
  return lines;
}

const LOG_ACTION_LABELS = {
  deploy: '部署',
  'deploy-global': '部署全局工作台',
  'deploy-skills': '接入技能 junction',
  merge: '冲突合并',
  uninstall: '卸载入口',
  'uninstall-skills': '卸载技能链接',
  'uninstall-global': '卸载全局链接',
  'backup-create': '主动备份',
  'backup-prune': '清理备份',
  'backup-restore': '恢复备份',
  attach: '挂载项目',
  detach: '取消项目挂载',
  'settings-set': '修改设置',
  'settings-unset': '删除设置',
  'content-save': '保存内容',
  'content-create': '新建内容'
};

const LOG_RESULT_LABELS = {
  written: '已写入',
  created: '已创建',
  deleted: '已删除',
  'removed-block': '已移除块',
  restored: '已恢复',
  applied: '已写入',
  removed: '已移除',
  absent: '无变化',
  unchanged: '无变化',
  failed: '失败'
};

export function renderLog(result) {
  const lines = [
    '操作历史',
    `  日志目录：${result.logsDir}`,
    `  记录：${result.total} 条${
      result.truncated ? `，按上限显示最近 ${result.entries.length} 条（--limit ${result.limit}）` : ''
    }`
  ];

  if (result.files.length > 0) {
    lines.push(
      `  日志文件：${result.files
        .map((file) => `${file.name}（${file.entries} 条）`)
        .join('、')}`
    );
  } else {
    lines.push('  日志文件：暂无');
  }

  if (result.entries.length > 0) {
    const rows = result.entries.map((entry) => [
      entry.at,
      LOG_ACTION_LABELS[entry.action] ?? entry.action,
      entry.source === 'gui' ? 'GUI' : 'CLI',
      entry.target ?? entry.tool ?? '—',
      logResultLabel(entry),
      entry.backup ?? '—'
    ]);
    lines.push('', table(['时间', '动作', '来源', '目标', '结果', '备份'], rows));
  } else {
    lines.push(
      '',
      '  暂无操作记录。部署、合并、备份、恢复、卸载、项目挂载、设置修改、内容保存或新建后会写入这里。'
    );
  }

  if (result.issues.length > 0) {
    lines.push('', `  无法解析的日志行：${result.issues.length} 条`);
    for (const issue of result.issues.slice(0, 5)) {
      lines.push(
        `    ${issue.file}${issue.line ? `:${issue.line}` : ''} ${issue.message}`
      );
    }
    if (result.issues.length > 5) {
      lines.push(`    其余 ${result.issues.length - 5} 条从略`);
    }
  }

  if (result.deploy?.targets?.length > 0) {
    lines.push('', '部署记录', `  上次运行：${result.deploy.lastRun ?? '（无）'}`);
    const rows = result.deploy.targets.map((target) => [
      target.tool,
      deployActionLabel(target.action),
      target.deployedAt ?? '—',
      target.manualMerge ? '是' : '否',
      target.backup ?? '—'
    ]);
    lines.push('', table(['工具', '动作', '部署时间', '手工合并', '备份'], rows));
  }

  if (result.deploy?.projects?.length > 0) {
    const rows = result.deploy.projects.map((project) => [
      project.projectPath,
      project.mode ?? '—',
      project.file ?? '—',
      project.attachedAt ?? '—'
    ]);
    lines.push('', '项目记录', table(['项目', '方式', '入口', '挂载时间'], rows));
  }

  return lines.join('\n');
}

function logResultLabel(entry) {
  const label = LOG_RESULT_LABELS[entry.result] ?? entry.result;
  return entry.detail?.error ? `${label}：${entry.detail.error}` : label;
}

function deployActionLabel(action) {
  const labels = {
    'create-file': '新建',
    'append-block': '追加',
    'update-block': '更新',
    unchanged: '无变化',
    'manual-merge': '手工合并',
    restored: '已恢复'
  };
  return labels[action] ?? action ?? '—';
}

export function renderDiagnose(result) {
  const health = result.health;
  const lines = [
    '诊断包已生成',
    `  机器：${result.summary.machine.host ?? '（未知）'}`,
    `  目录：${result.outputDir}`,
    result.zip
      ? `  压缩包：${result.zip.path}（${formatBytes(result.zip.bytes)}，${result.zip.entries} 个文件）`
      : '  压缩包：未生成（加 --zip 生成）',
    `  文件：${result.files
      .map((file) => `${file.name}（${formatBytes(file.bytes)}）`)
      .join('、')}`,
    `  体检：${
      health.error
        ? `不可用（${health.error}）`
        : `${health.ok ? '通过' : '未通过'}（通过 ${health.pass}，待处理 ${health.pending}，失败 ${health.fail}）`
    }`,
    `  部署状态：${diagnoseDeployLabel(result.summary.deploy)}`,
    `  日志：${diagnoseLogLabel(result.summary.log)}`,
    `  路径：工具 ${result.summary.paths.tools} 个，项目 ${result.summary.paths.projects} 个`
  ];

  for (const check of health.failed ?? []) {
    lines.push(`  [失败] ${check.title}：${check.detail}`);
  }

  const extraIssues = result.issues.filter((issue) => issue.section !== 'doctor');
  for (const issue of extraIssues.slice(0, 5)) {
    lines.push(`  [问题] ${issue.section}：${issue.message}`);
  }
  if (extraIssues.length > 5) {
    lines.push(`  [问题] 其余 ${extraIssues.length - 5} 项从略`);
  }

  lines.push(
    '',
    '  诊断包包含本机路径与主机名；不含机器档案正文、环境变量值、内容正文或令牌。发给他人前请先复核。'
  );
  return lines.join('\n');
}

function diagnoseDeployLabel(deploy) {
  if (deploy.error) return `不可用（${deploy.error}）`;
  const summary = deploy.summary;
  return `正常 ${summary.ok}，待更新 ${summary.stale}，漂移 ${summary.drift}，缺失 ${summary.missing}，未部署 ${summary.notDeployed}，未安装 ${summary.notInstalled}，预留 ${summary.disabled}，其他 ${summary.manual}`;
}

function diagnoseLogLabel(log) {
  if (log.error) return `不可用（${log.error}）`;
  return `${log.total} 条${log.truncated ? `，仅包含最近 ${log.shown} 条` : ''}${
    log.issues > 0 ? `，${log.issues} 行无法解析` : ''
  }`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function renderSettings(result) {
  const sourceLabel = { machine: '机器档案', default: '默认' };
  const changeLabel = {
    set: '新增',
    update: '修改',
    unset: '删除',
    unchanged: '无变化'
  };

  if (result.subcommand === 'show') {
    const lines = [
      '机器档案设置',
      `  文件：${result.filePath ?? '（不可用）'}`,
      `  编码：${result.encoding ?? '（不可用）'}${result.writable ? '' : '（不可写）'}`,
      `  文件哈希：${result.fileHash ?? '（不可用）'}`,
      `  备份保留：${result.backupRetention.value} 份（${sourceLabel[result.backupRetention.source] ?? result.backupRetention.source}）`,
      `  GUI 端口：${portLabel(result.guiPort.value)}（${sourceLabel[result.guiPort.source] ?? result.guiPort.source}）`,
      `  设置节：${settingsSectionLabel(result)}`
    ];

    const envRows = Object.entries(result.env).map(([name, value]) => [name, value]);
    if (envRows.length > 0) {
      lines.push('', table(['环境变量', '值'], envRows));
    } else {
      lines.push('', '  环境变量：暂无');
    }

    if (result.tools.length > 0) {
      const rows = result.tools.map((tool) => [
        tool.name,
        tool.custom ? '自定义' : '内置',
        tool.enabled ? '是' : '否',
        tool.installed ? '是' : '否',
        tool.entryPath,
        tool.entryExists ? (tool.usingFallback ? '是（备选）' : '是') : '否',
        tool.skillsDir ?? '—',
        overrideSummary(tool.overrides)
      ]);
      lines.push(
        '',
        table(['工具', '来源', '启用', '安装', '入口', '入口存在', '技能目录', '覆盖'], rows)
      );
    }

    if (result.targetsError) {
      lines.push('', `  工具解析失败：${result.targetsError}`);
    }
    for (const issue of result.issues) {
      lines.push(`  [问题] ${issue.key}：${issue.message}`);
    }
    return lines.join('\n');
  }

  const statusLabel = {
    preview: '预演（不会写入文件）',
    applied: '已写入机器档案',
    unchanged: '无变化',
    blocked: '已阻止'
  };
  const lines = [
    `${statusLabel[result.status] ?? result.status}`,
    `  文件：${result.filePath}`,
    `  文件哈希：${result.fileHash}`
  ];

  const rows = result.changes.map((change) => [
    change.key,
    changeLabel[change.action] ?? change.action,
    formatSettingValue(change.from),
    formatSettingValue(change.to)
  ]);
  lines.push('', table(['设置项', '动作', '原值', '新值'], rows));

  if (result.reason) lines.push('', `结果：${result.reason}`);
  if (result.backup) lines.push(`  备份：${result.backup}`);
  if (result.dryRun && result.canApply) {
    lines.push('', '  加 --apply 写入；写入前会备份机器档案。');
  }
  if (result.dryRun && result.canApply === false && result.issues.length > 0) {
    lines.push('', '  修复下列问题后才能写入：');
  }
  for (const issue of result.issues) {
    lines.push(`  [问题] ${issue.key}：${issue.message}`);
  }
  if (result.status === 'blocked' && result.canForce) {
    lines.push('', '  确认无需修复时可加 --force 写入，写入后仍会保留问题提示。');
  }
  return lines.join('\n');
}

function settingsSectionLabel(result) {
  if (!result.available) return '机器档案不可用';
  if (!result.hasSection) return '尚未创建，首次写入设置时自动追加';
  if (!result.hasBlock) return '已存在，但缺少 ```json 代码块；写入时会补上';
  return '已存在并已解析';
}

function portLabel(value) {
  return value === 0 ? '0（自动分配）' : String(value);
}

function overrideSummary(overrides) {
  const fields = [];
  if (overrides.enabled !== null) fields.push(`启用=${overrides.enabled ? 'true' : 'false'}`);
  for (const field of ['configRoot', 'entryPath', 'skillsDir']) {
    if (overrides[field]) fields.push(`${field}=${overrides[field]}`);
  }
  return fields.length > 0 ? fields.join('；') : '—';
}

function formatSettingValue(value) {
  if (value === null || value === undefined) return '（未设置）';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
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
    `  全局工作台：${result.global.label}${
      result.global.configured ? `（${result.global.linkPath}）` : ''
    }`,
    result.global.reason ? `    说明：${result.global.reason}` : null,
    result.build.error ? `  构建清单错误：${result.build.error}` : null,
    '',
    table(['工具', '状态', '记录', '入口'], rows),
    '',
    `汇总：正常 ${result.summary.ok}，待更新 ${result.summary.stale}，漂移 ${result.summary.drift}，缺失 ${result.summary.missing}，未部署 ${result.summary.notDeployed}，未安装 ${result.summary.notInstalled}，预留 ${result.summary.disabled}，其他 ${result.summary.manual}`
  ];

  return lines.filter((line) => line !== null).join('\n');
}

export function renderDoctor(result) {
  const statusLabel = { pass: '[通过]', fail: '[失败]', pending: '[待处理]' };
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
    '当前阶段：deploy、uninstall、merge、backup prune 与 backup restore 默认预演，--apply 才写外部文件或删除；backup create 只写本地备份；deploy 同时管理技能 junction；GUI 提供总览、部署、合并、项目、内容、设置、备份、历史与诊断（aiwb gui）。'
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

function applyStatusLabel(status) {
  return (
    {
      written: '已写入',
      unchanged: '无变化',
      skipped: '已跳过',
      aborted: '未执行',
      failed: '失败'
    }[status] ?? ''
  );
}

function globalActionLabel(action) {
  return (
    {
      'create-directory': '[新建]',
      'create-junction': '[新建]',
      unchanged: '[无变化]',
      conflict: '[冲突]'
    }[action] ?? `[${action}]`
  );
}

function skillStatusLabel(status) {
  return (
    {
      'create-junction': '[新建]',
      'create-directory': '[新建]',
      created: '[已创建]',
      unchanged: '[无变化]',
      conflict: '[冲突]',
      skipped: '[跳过]',
      failed: '[失败]',
      aborted: '[未执行]',
      'skip-not-installed': '[跳过]',
      'skip-unsupported': '[跳过]',
      'skip-disabled': '[跳过]',
      'no-skills': '[跳过]'
    }[status] ?? `[${status}]`
  );
}

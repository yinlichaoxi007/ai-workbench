const token = new URLSearchParams(location.search).get('token') ?? '';
const $ = (selector) => document.querySelector(selector);

let lastDeployTool = '';
let pendingRestore = null;
let pendingPrune = null;
let pendingUninstall = null;
let pendingProject = null;
let currentProject = null;
let projectScanState = null;
let projectPage = 1;
let projectPageSize = 10;

const ACTION_LABELS = {
  'create-file': '新建文件',
  'append-block': '追加块',
  'update-block': '更新块',
  unchanged: '无变化',
  manual: '需人工',
  'skip-not-installed': '未安装',
  'skip-unsupported': '不接入',
  'skip-disabled': '预留'
};

const APPLY_LABELS = {
  written: '已写入',
  created: '已创建',
  unchanged: '无变化',
  skipped: '已跳过',
  aborted: '未执行',
  failed: '失败'
};

const SKILL_ACTION_LABELS = {
  'create-junction': '新建',
  'create-directory': '新建',
  unchanged: '无变化',
  conflict: '冲突',
  'skip-not-installed': '跳过',
  'skip-unsupported': '跳过',
  'skip-disabled': '跳过',
  'no-skills': '跳过'
};

const BACKUP_LABELS = {
  restore: '可恢复',
  restored: '已恢复',
  unchanged: '无需恢复',
  blocked: '已阻止'
};

const BACKUP_CREATE_LABELS = {
  created: '已创建',
  missing: '无入口',
  failed: '失败'
};

const BACKUP_PRUNE_LABELS = {
  delete: '将删除',
  deleted: '已删除',
  keep: '保留',
  skipped: '跳过',
  failed: '失败'
};

const UNINSTALL_ENTRY_LABELS = {
  'delete-file': '删除文件',
  'remove-block': '移除块',
  absent: '无需处理',
  blocked: '已阻止',
  failed: '失败',
  aborted: '未执行',
  deleted: '已删除文件',
  'removed-block': '已移除块'
};

const UNINSTALL_LINK_LABELS = {
  'remove-junction': '将移除',
  removed: '已移除',
  conflict: '冲突',
  absent: '无链接',
  skipped: '跳过',
  failed: '失败',
  aborted: '未执行'
};

const UNINSTALL_GLOBAL_LABELS = {
  'remove-junction': '将移除脚本 junction',
  removed: '已移除脚本 junction',
  absent: '无需处理',
  conflict: '冲突',
  unconfigured: '未配置',
  skipped: '跳过',
  failed: '失败',
  aborted: '未执行'
};

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hashShort(value) {
  if (!value) return '（无）';
  return `${value.slice(0, 19)}…`;
}

function showError(error) {
  const box = $('#error');
  box.textContent = error instanceof Error ? error.message : String(error);
  box.hidden = false;
}

function clearError() {
  $('#error').hidden = true;
  $('#error').textContent = '';
}

function setConn(ok, text) {
  const badge = $('#conn');
  badge.textContent = text;
  badge.classList.toggle('bad', !ok);
}

async function api(action, params = {}, confirm = false) {
  const response = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AIWB-Token': token },
    body: JSON.stringify({ action, params, confirm })
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`响应无法解析（HTTP ${response.status}）`);
  }

  if (!response.ok || !data.ok) {
    throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
  }
  return data.result;
}

async function withBusy(button, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '处理中…';
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function table(headers, rows) {
  if (rows.length === 0) return '<p class="muted">暂无数据。</p>';
  const head = headers.map((header) => `<th>${esc(header)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function actionLabel(action) {
  return ACTION_LABELS[action] ?? action;
}

function globalActionLabel(action) {
  return (
    {
      'create-directory': '新建',
      'create-junction': '新建',
      unchanged: '无变化',
      conflict: '冲突'
    }[action] ?? action
  );
}

function renderGlobal(global) {
  if (!global) {
    return '<p class="muted">本次指定了单个工具或未涉及全局工作台。</p>';
  }

  const dirs = global.dirs
    .map(
      (dir) =>
        `<li>${esc(globalActionLabel(dir.action))} ${esc(dir.name)}/：<code>${esc(dir.path)}</code></li>`
    )
    .join('');
  const link = global.link;
  const linkLine = `<li>${esc(globalActionLabel(link.action))} 脚本入口：<code>${esc(
    link.path
  )}</code> → <code>${esc(link.target)}</code></li>`;

  return [
    `<p>根目录：<code>${esc(global.globalRoot)}</code></p>`,
    `<ul class="list">${dirs}${linkLine}</ul>`,
    global.ok ? '' : '<p class="notice warn">存在冲突，执行时不会写入任何文件。</p>'
  ].join('');
}

function renderSkills(skills, applied) {
  if (!skills) return '<p class="muted">本次未规划技能 junction。</p>';
  if (skills.skills.length === 0) return '<p class="muted">暂无自建技能。</p>';

  const rows = [];
  for (const tool of skills.tools) {
    if (tool.links.length === 0) {
      const status = applied ? (tool.applyStatus ?? tool.action) : tool.action;
      rows.push([
        esc(tool.name),
        '—',
        esc(skillStatusLabel(status, applied)),
        tool.skillsDir ? `<code>${esc(tool.skillsDir)}</code>` : '—',
        esc(tool.reason)
      ]);
      continue;
    }

    for (const link of tool.links) {
      const status = applied ? (link.applyStatus ?? link.action) : link.action;
      rows.push([
        esc(tool.name),
        esc(link.skill),
        esc(skillStatusLabel(status, applied)),
        `<code>${esc(link.path)}</code>`,
        esc(link.error ?? link.reason)
      ]);
    }
  }

  const summary = skills.summary;
  const summaryText = [
    `${skills.applied ? '已创建' : '新建'} ${summary.create}`,
    `无变化 ${summary.unchanged}`,
    `冲突 ${summary.conflict}`,
    `跳过 ${summary.skipped}`,
    `失败 ${summary.failed}`
  ].join('，');

  const notices = [
    skills.aborted
      ? '<p class="notice warn">入口写入失败或全局工作台存在冲突，技能 junction 本次未执行。</p>'
      : '',
    summary.conflict > 0
      ? '<p class="notice warn">同名路径已存在或链接指向别处，冲突项保持原样，不会覆盖用户技能。</p>'
      : ''
  ].join('');

  return [
    notices,
    `<p class="hint">源目录：<code>${esc(skills.sourceDir)}</code> · ${esc(summaryText)}</p>`,
    `<div class="table-wrap">${table(['工具', '技能', '动作', '路径', '说明'], rows)}</div>`
  ].join('');
}

function skillStatusLabel(status, applied) {
  const labels = applied ? APPLY_LABELS : SKILL_ACTION_LABELS;
  return labels[status] ?? status ?? '';
}

function renderDeployPlan(result) {
  const summary = result.summary;
  const summaryText = [
    `新建 ${summary.create}`,
    `追加 ${summary.append}`,
    `更新 ${summary.update}`,
    `无变化 ${summary.unchanged}`,
    `需人工 ${summary.manual}`,
    `跳过 ${summary.skipped}`
  ].join('，');

  const rows = result.targets.map((target) => [
    esc(target.name),
    esc(actionLabel(target.action)),
    esc(target.reason),
    `<code>${esc(target.entryPath)}</code>`
  ]);

  const manual = result.targets.filter((target) => target.action === 'manual');
  const manualHtml =
    manual.length === 0
      ? ''
      : `<div class="notice warn"><strong>需人工处理</strong><ul class="list">${manual
          .map((target) => `<li>${esc(target.name)}：${esc(target.reason)}</li>`)
          .join('')}</ul></div>`;

  return [
    `<div class="notice">机器 ${esc(result.machine.host)} · 构建 ${esc(
      hashShort(result.build.contentHash)
    )} · ${esc(summaryText)}</div>`,
    `<h2>全局工作台</h2><div class="notice">${renderGlobal(result.global)}</div>`,
    `<h2>入口动作</h2><div class="table-wrap">${table(['工具', '动作', '说明', '入口'], rows)}</div>`,
    `<h2>技能 junction</h2>${renderSkills(result.skills, false)}`,
    manualHtml
  ].join('');
}

function renderDeployApplied(result) {
  const apply = result.apply ?? {};
  const rows = result.targets.map((target) => [
    esc(target.name),
    esc(actionLabel(target.action)),
    esc(APPLY_LABELS[target.applyStatus] ?? target.applyStatus ?? ''),
    esc(target.reason),
    `<code>${esc(target.entryPath)}</code>`
  ]);

  const summary = `写入 ${apply.written ?? 0}，无变化 ${apply.unchanged ?? 0}，跳过 ${
    apply.skipped ?? 0
  }，失败 ${apply.failed ?? 0}`;
  const failure = apply.failure
    ? `<p class="notice warn">失败：${esc(apply.failure.name)}：${esc(apply.failure.error)}</p>`
    : '';

  return [
    `<div class="notice ${apply.ok ? 'ok' : 'warn'}">${esc(summary)}${
      apply.reason ? ` · ${esc(apply.reason)}` : ''
    }</div>`,
    failure,
    `<h2>执行结果</h2><div class="table-wrap">${table(
      ['工具', '计划动作', '结果', '说明', '入口'],
      rows
    )}</div>`,
    `<h2>技能 junction</h2>${renderSkills(result.skills, true)}`
  ].join('');
}

function renderBackupList(result) {
  const rows = result.backups.map((backup) => [
    esc(backup.toolName),
    esc(backup.backedUpAt),
    esc(backup.action),
    `<code>${esc(backup.entryPath)}</code>`,
    `<code>${esc(backup.stamp)}</code>`,
    backup.backupFileExists ? '完整' : '缺文件',
    `<button class="small" data-tool="${esc(backup.tool)}" data-stamp="${esc(
      backup.stamp
    )}">预览恢复</button>`
  ]);

  const invalid =
    result.invalid.length === 0
      ? ''
      : `<div class="notice warn"><strong>不可用的备份</strong><ul class="list">${result.invalid
          .map((item) => `<li>${esc(item.relativeDir)}：${esc(item.error)}</li>`)
          .join('')}</ul></div>`;

  return [
    `<p class="hint">共 ${result.backups.length} 份备份。</p>`,
    `<div class="table-wrap">${table(
      ['工具', '备份时间', '动作', '入口', '时间戳', '文件', '操作'],
      rows
    )}</div>`,
    invalid
  ].join('');
}

function renderBackupCreate(result) {
  const summary = result.summary;
  const rows = result.tools.map((tool) => [
    esc(tool.name),
    esc(BACKUP_CREATE_LABELS[tool.status] ?? tool.status),
    `<code>${esc(tool.entryPath)}</code>`,
    tool.backup ? `<code>${esc(tool.backup)}</code>` : '—',
    esc(tool.reason ?? '')
  ]);
  const tone = summary.failed > 0 ? 'warn' : summary.created > 0 ? 'ok' : '';
  const empty =
    summary.created === 0 && summary.failed === 0
      ? '<p class="hint">没有找到可备份的入口文件。</p>'
      : '';

  return [
    `<div class="notice${tone ? ` ${tone}` : ''}">已创建 ${summary.created}，无入口 ${summary.missing}，失败 ${summary.failed}</div>`,
    empty,
    `<div class="table-wrap">${table(['工具', '结果', '入口', '备份', '说明'], rows)}</div>`
  ].join('');
}

function renderBackupPrune(result) {
  const summary = result.summary;
  const rows = result.items
    .filter((item) => item.status !== 'keep')
    .map((item) => [
      esc(item.toolName),
      esc(item.stamp),
      `<code>${esc(item.relativeDir)}</code>`,
      esc(BACKUP_PRUNE_LABELS[item.status] ?? item.status),
      esc(item.reason)
    ]);
  const summaryText = result.dryRun
    ? `每工具保留最近 ${result.keep} 份；共 ${summary.total} 份，保留 ${summary.kept}，将删除 ${summary.delete}，跳过 ${summary.skipped}`
    : `每工具保留最近 ${result.keep} 份；已删除 ${summary.deleted}，跳过 ${summary.skipped}，失败 ${summary.failed}`;
  const tone = summary.failed > 0 ? 'warn' : !result.dryRun && summary.deleted > 0 ? 'ok' : '';
  const detail =
    rows.length === 0
      ? '<p class="hint">没有需要清理的备份。</p>'
      : `<div class="table-wrap">${table(['工具', '时间戳', '备份', '结果', '说明'], rows)}</div>`;

  return [
    `<div class="notice${tone ? ` ${tone}` : ''}">${esc(summaryText)}</div>`,
    detail
  ].join('');
}

function renderBackupResult(result) {
  const status = BACKUP_LABELS[result.status] ?? result.status;
  const warning = ['blocked'].includes(result.status) ? 'warn' : result.status === 'restore' ? '' : 'ok';
  const safety = result.safetyBackup
    ? `<p class="hint">恢复前备份：<code>${esc(result.safetyBackup)}</code></p>`
    : '';

  return [
    `<div class="notice ${warning}">${esc(status)}：${esc(result.reason)}</div>`,
    `<div class="notice">`,
    `<p>入口：<code>${esc(result.entryPath)}</code></p>`,
    `<p>备份：<code>${esc(result.backupFile)}</code>（${esc(hashShort(result.backupHash))}）</p>`,
    `<p>当前：${result.currentHash ? esc(hashShort(result.currentHash)) : '（入口不存在）'}</p>`,
    safety,
    '</div>'
  ].join('');
}

const PROJECT_ATTACH_LABELS = {
  'create-file': '将新建文件',
  'append-block': '将追加块',
  'update-block': '将更新块',
  unchanged: '无需变更',
  created: '已新建文件',
  appended: '已追加块',
  updated: '已更新块',
  blocked: '已阻止',
  failed: '失败'
};

const PROJECT_DETACH_LABELS = {
  'remove-block': '将移除块',
  'delete-file': '将删除文件',
  'removed-block': '已移除块',
  deleted: '已删除文件',
  absent: '无需处理',
  blocked: '已阻止',
  failed: '失败'
};

function projectRepoLabel(project) {
  if (!project.isRepo) return '否';
  return project.gitWarning ? '工作树/子模块' : '是';
}

function projectTrackingLabel(project) {
  if (!project.isRepo) return '—';
  if (project.tracked === true) return '已跟踪';
  if (project.tracked === false) return '未跟踪';
  return '未知';
}

function projectIgnoreLabel(project) {
  if (!project.isRepo) return '—';
  return project.excludePresent ? '已忽略' : '未忽略';
}

function renderProjectScan(result, pageProjects) {
  const summary = result.summary;
  const parts = [
    `共 ${summary.total}`,
    `已挂载 ${summary.mounted}`,
    `待更新 ${summary.stale}`,
    `块被手改 ${summary.drift}`,
    `块缺失 ${summary.missingBlock}`,
    `入口缺失 ${summary.missingEntry}`,
    `有块无记录 ${summary.unmanaged}`,
    `入口已跟踪 ${summary.tracked}`,
    `未挂载 ${summary.notMounted}`,
    `目录缺失 ${summary.missing}`,
    `异常 ${summary.malformed + summary.unsupported}`
  ];
  const warnings = result.warnings.map((warning) => `<li>${esc(warning)}</li>`).join('');
  const rows = pageProjects.map((project) => [
    esc(project.name),
    esc(project.label),
    esc(project.file ?? '—'),
    project.recorded ? '有' : '无',
    esc(projectRepoLabel(project)),
    esc(projectTrackingLabel(project)),
    esc(projectIgnoreLabel(project)),
    `<code>${esc(project.path)}</code>`,
    `<button class="small" data-project-path="${esc(project.path)}">操作</button>`
  ]);

  return [
    `<div class="notice">${esc(parts.join('，'))}</div>`,
    `<p class="hint">来源：${result.source === 'option' ? '--root' : '机器档案'} · 项目父级：<code>${esc(
      result.roots.join('；') || '（未配置）'
    )}</code> · 构建产物：${result.buildExists ? '存在' : '缺失，先运行构建'}</p>`,
    warnings ? `<div class="notice warn"><ul class="list">${warnings}</ul></div>` : '',
    `<div class="table-wrap project-table">${table(
      ['项目', '状态', '入口', '记录', 'Git 仓库', '入口跟踪', '本地忽略', '路径', '操作'],
      rows
    )}</div>`
  ].join('');
}

function normalizeProjectPageSize(value) {
  const size = Math.floor(Number(value));
  return Number.isFinite(size) && size >= 1 ? size : null;
}

function syncProjectPageSizeMenu() {
  document.querySelectorAll('#project-page-size-menu [data-project-page-size]').forEach((button) => {
    const selected = Number(button.dataset.projectPageSize) === projectPageSize;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-selected', String(selected));
  });
}

function closeProjectPageSizeMenu() {
  const menu = $('#project-page-size-menu');
  if (menu.hidden) return;
  menu.hidden = true;
  $('#project-page-size-toggle').setAttribute('aria-expanded', 'false');
}

function toggleProjectPageSizeMenu() {
  const menu = $('#project-page-size-menu');
  if (!menu.hidden) {
    closeProjectPageSizeMenu();
    return;
  }
  syncProjectPageSizeMenu();
  menu.hidden = false;
  $('#project-page-size-toggle').setAttribute('aria-expanded', 'true');
}

function applyProjectPageSize(value) {
  const size = normalizeProjectPageSize(value);
  if (size === null) return null;
  projectPageSize = size;
  projectPage = 1;
  $('#project-page-size').value = String(size);
  renderProjectList();
  return size;
}

function renderProjectPager(total, startIndex, pageCount, totalPages) {
  const start = total === 0 ? 0 : startIndex + 1;
  const end = startIndex + pageCount;
  return [
    `<span>第 ${start}–${end} 条，共 ${total} 条</span>`,
    `<div>`,
    `<button class="small" data-project-page="${projectPage - 1}" ${
      projectPage <= 1 ? 'disabled' : ''
    }>上一页</button>`,
    `<span>第 ${projectPage} / ${totalPages} 页</span>`,
    `<button class="small" data-project-page="${projectPage + 1}" ${
      projectPage >= totalPages ? 'disabled' : ''
    }>下一页</button>`,
    `</div>`
  ].join('');
}

function renderProjectList() {
  const result = projectScanState;
  if (!result) return;
  const total = result.projects.length;
  const totalPages = Math.max(1, Math.ceil(total / projectPageSize));
  projectPage = Math.min(Math.max(1, projectPage), totalPages);
  const startIndex = (projectPage - 1) * projectPageSize;
  const pageProjects = result.projects.slice(startIndex, startIndex + projectPageSize);
  $('#project-scan-result').innerHTML = renderProjectScan(result, pageProjects);
  $('#project-pagination').innerHTML = renderProjectPager(
    total,
    startIndex,
    pageProjects.length,
    totalPages
  );
}

function renderProjectOperation(result) {
  const attach = result.subcommand === 'attach';
  const plan = result.project;
  const labels = attach ? PROJECT_ATTACH_LABELS : PROJECT_DETACH_LABELS;
  const status = attach
    ? (plan.applyStatus ?? (plan.status === 'blocked' ? 'blocked' : plan.action))
    : (plan.applyStatus ?? plan.status);
  const label = labels[status] ?? status;
  const tone =
    plan.status === 'blocked' || plan.error || plan.applyStatus === 'failed'
      ? 'warn'
      : result.dryRun
        ? ''
        : 'ok';
  const excludeLabel = {
    add: result.dryRun ? '将写入忽略行（仅本机生效）' : '已写入忽略行（仅本机生效）',
    added: '已写入忽略行（仅本机生效）',
    remove: result.dryRun ? '将移除忽略行' : '已移除忽略行',
    removed: '已移除忽略行',
    unchanged: '无需改动',
    skip: `跳过（${plan.exclude?.reason ?? ''}）`,
    none: `无需处理（${plan.exclude?.reason ?? ''}）`
  };

  return [
    `<div class="notice${tone ? ` ${tone}` : ''}">${result.dryRun ? '预演' : '已执行'} · ${esc(
      plan.name
    )} · ${esc(label)}${result.force ? ' · --force' : ''}</div>`,
    `<p>项目：<code>${esc(plan.projectPath)}</code></p>`,
    plan.targetPath ? `<p>入口：<code>${esc(plan.targetPath)}</code>（${esc(plan.mode)}）</p>` : '',
    plan.reason && (result.dryRun || plan.status === 'blocked')
      ? `<p class="hint">${esc(plan.reason)}</p>`
      : '',
    plan.exclude
      ? `<p class="hint">本地忽略（.git/info/exclude）：${esc(
          excludeLabel[plan.exclude.action] ?? plan.exclude.action
        )}</p>`
      : '',
    plan.tracked === true && attach
      ? '<p class="notice warn">入口已被 git 跟踪；auto/local 默认不写，append 会显式追加块。</p>'
      : '',
    plan.backup || result.apply?.backup
      ? `<p class="hint">备份：<code>${esc(plan.backup ?? result.apply.backup)}</code></p>`
      : '',
    plan.error ? `<p class="notice warn">${esc(plan.error)}</p>` : '',
    result.apply?.reason ? `<p class="notice warn">${esc(result.apply.reason)}</p>` : ''
  ]
    .filter(Boolean)
    .join('');
}

function updateProjectDialog() {
  if (!currentProject) return;
  const git = projectRepoLabel(currentProject);
  const tracking = projectTrackingLabel(currentProject);
  const ignore = projectIgnoreLabel(currentProject);
  $('#project-dialog-title').textContent = `${currentProject.name} · ${currentProject.label}`;
  $('#project-dialog-meta').innerHTML = [
    `路径：<code>${esc(currentProject.path)}</code>`,
    `入口：<code>${esc(currentProject.targetPath)}</code>（${esc(currentProject.file)}）`,
    `Git 仓库：${esc(git)} · 入口跟踪：${esc(tracking)} · 本地忽略（.git/info/exclude）：${esc(ignore)}`,
    currentProject.gitWarning ? `提示：${esc(currentProject.gitWarning)}` : null
  ]
    .filter(Boolean)
    .join('<br>');
}

function refreshProjectDialog(result) {
  if (!currentProject || !$('#project-dialog').open) return;
  const updated = result.projects.find((project) => project.path === currentProject.path);
  if (updated) currentProject = updated;
  updateProjectDialog();
}

function openProjectDialog(project) {
  currentProject = project;
  pendingProject = null;
  $('#project-mode').value = project.mode ?? 'auto';
  $('#project-force').checked = false;
  $('#project-op-result').innerHTML = '';
  $('#project-apply-box').hidden = true;
  updateProjectDialog();
  const dialog = $('#project-dialog');
  if (!dialog.open) dialog.showModal();
}

async function scanProjectList() {
  clearError();
  const result = await api('scan');
  setConn(true, '已连接');
  projectScanState = result;
  renderProjectList();
  refreshProjectDialog(result);
}

async function previewProject(subcommand) {
  clearError();
  if (!currentProject) throw new Error('请先扫描并打开一个项目的操作弹层');
  const projectPath = currentProject.path;
  const params = { path: projectPath };
  if (subcommand === 'attach') params.mode = $('#project-mode').value;
  if (subcommand === 'detach' && $('#project-force').checked) params.force = true;

  const result = await api(subcommand, params);
  $('#project-op-result').innerHTML = renderProjectOperation(result);

  if (result.project.canApply) {
    pendingProject = {
      subcommand,
      path: projectPath,
      mode: params.mode,
      force: params.force === true
    };
    $('#project-apply-target').textContent = `${
      subcommand === 'attach' ? '挂载' : '取消挂载'
    }：${result.project.name} · ${result.project.targetPath ?? projectPath}`;
    $('#project-confirm').checked = false;
    $('#project-apply').disabled = true;
    $('#project-apply').textContent = subcommand === 'attach' ? '执行挂载' : '执行取消挂载';
    $('#project-apply-box').hidden = false;
  } else {
    pendingProject = null;
    $('#project-apply-box').hidden = true;
  }
}

async function applyProject() {
  if (!pendingProject) throw new Error('请先预演项目操作');
  const params = { path: pendingProject.path, apply: true };
  if (pendingProject.mode) params.mode = pendingProject.mode;
  if (pendingProject.force) params.force = true;

  const result = await api(pendingProject.subcommand, params, true);
  $('#project-op-result').innerHTML = renderProjectOperation(result);
  $('#project-apply-box').hidden = true;
  pendingProject = null;
  await scanProjectList();
}

function uninstallEntryLabel(target, dryRun) {
  const status = target.applyStatus ?? target.status;
  if (status === 'delete-file' || status === 'deleted') {
    return dryRun ? '将删除文件' : '已删除文件';
  }
  if (status === 'remove-block' || status === 'removed-block') {
    return dryRun ? '将移除块' : '已移除块';
  }
  return UNINSTALL_ENTRY_LABELS[status] ?? status;
}

function renderUninstall(result) {
  const summary = result.summary;
  const summaryText = result.dryRun
    ? `删除文件 ${summary.deleteFile}，移除块 ${summary.removeBlock}，无需处理 ${summary.absent}，已阻止 ${summary.blocked}；技能 junction 将移除 ${summary.skillsRemove}、冲突 ${summary.skillsConflict}`
    : `已删除文件 ${summary.deleted}，已移除块 ${summary.blocksRemoved}，无需处理 ${summary.absent}，已阻止 ${summary.blocked}，失败 ${summary.failed}；技能 junction 已移除 ${summary.skillsRemoved}、冲突 ${summary.skillsConflict}、失败 ${summary.skillsFailed}`;
  const tone =
    summary.failed > 0 || summary.blocked > 0 || summary.skillsFailed > 0
      ? 'warn'
      : !result.dryRun
        ? 'ok'
        : '';
  const scopeText = `${result.scope.tool ?? '全部工具'}${result.scope.force ? ' · --force' : ''}`;

  const entryRows = result.targets
    .filter((target) => target.status !== 'absent')
    .map((target) => [
      esc(target.name),
      esc(uninstallEntryLabel(target, result.dryRun)),
      esc(target.reason),
      `<code>${esc(target.entryPath)}</code>`
    ]);
  const entries =
    entryRows.length === 0
      ? '<p class="hint">没有需要卸载的入口。</p>'
      : `<div class="table-wrap">${table(['工具', '动作', '说明', '入口'], entryRows)}</div>`;

  const linkRows = [];
  for (const tool of result.skills.tools) {
    for (const link of tool.links) {
      const status = link.applyStatus ?? link.action;
      const show =
        link.action === 'remove-junction' ||
        link.action === 'conflict' ||
        status === 'failed' ||
        status === 'aborted';
      if (!show) continue;
      linkRows.push([
        esc(tool.name),
        esc(link.skill),
        esc(UNINSTALL_LINK_LABELS[status] ?? status),
        `<code>${esc(link.path)}</code> → <code>${esc(link.currentTarget ?? link.target)}</code>`
      ]);
    }
  }
  const skills =
    linkRows.length === 0
      ? '<p class="hint">没有需要移除的技能 junction。</p>'
      : `<div class="table-wrap">${table(['工具', '技能', '动作', '路径'], linkRows)}</div>`;

  const global = result.global;
  const globalHtml = global
    ? [
        `<h2>全局脚本 junction</h2>`,
        `<div class="notice${global.applyStatus === 'failed' || global.status === 'conflict' ? ' warn' : ''}">`,
        `<p>状态：${esc(UNINSTALL_GLOBAL_LABELS[global.applyStatus ?? global.status] ?? global.status)}</p>`,
        global.globalRoot ? `<p>根目录：<code>${esc(global.globalRoot)}</code></p>` : '',
        global.path ? `<p>脚本入口：<code>${esc(global.path)}</code></p>` : '',
        global.target ? `<p>目标：<code>${esc(global.target)}</code></p>` : '',
        global.reason ? `<p class="muted">${esc(global.reason)}</p>` : '',
        global.error ? `<p class="muted">${esc(global.error)}</p>` : '',
        '</div>'
      ].join('')
    : '<h2>全局脚本 junction</h2><p class="hint">本次指定了单个工具，不处理全局工作台。</p>';

  const backups = result.targets
    .filter((target) => target.backup)
    .map((target) => `<li>${esc(target.name)}：<code>${esc(target.backup)}</code></li>`)
    .join('');
  const backupHtml = backups
    ? `<h3>卸载前备份</h3><ul class="list">${backups}</ul>`
    : '';

  return [
    `<div class="notice${tone ? ` ${tone}` : ''}">范围：${esc(scopeText)} · ${esc(summaryText)}</div>`,
    `<h2>入口</h2>${entries}`,
    `<h2>技能 junction</h2>${skills}`,
    globalHtml,
    backupHtml
  ].join('');
}

async function loadOverview() {
  clearError();
  const [status, detect] = await Promise.all([api('status'), api('detect')]);
  setConn(true, '已连接');

  const cards = [
    ['机器', `${status.machine.host}`],
    ['构建', hashShort(status.build.contentHash)],
    ['全局工作台', `${status.global.label}${status.global.reason ? ` · ${status.global.reason}` : ''}`],
    [
      '部署记录',
      `${status.state.recordedTargets} 个目标${status.state.lastRun ? ` · ${status.state.lastRun}` : ''}`
    ]
  ];
  $('#overview-cards').innerHTML = cards
    .map(
      ([label, value]) =>
        `<div class="card"><div class="label">${esc(label)}</div><div class="value">${esc(
          value
        )}</div></div>`
    )
    .join('');

  const rows = status.targets.map((target) => [
    esc(target.name),
    esc(target.label),
    target.recorded ? '有' : '无',
    `<code>${esc(target.entryPath)}</code>`
  ]);
  $('#overview-table').innerHTML = table(['工具', '状态', '部署记录', '入口'], rows);

  const global = status.global;
  $('#global-info').innerHTML = global.configured
    ? [
        `<p>根目录：<code>${esc(global.globalRoot)}</code></p>`,
        `<p>脚本入口：<code>${esc(global.linkPath)}</code></p>`,
        `<p>状态：${esc(global.label)}${global.reason ? ` · ${esc(global.reason)}` : ''}</p>`
      ].join('')
    : `<p class="muted">${esc(global.reason)}</p>`;

  fillToolSelect(detect.tools);
}

function fillToolSelect(tools) {
  const select = $('#deploy-tool');
  const current = lastDeployTool;
  select.innerHTML = '<option value="">全部</option>';
  for (const tool of tools) {
    const option = document.createElement('option');
    option.value = tool.id;
    option.textContent = tool.enabled ? tool.name : `${tool.name}（预留）`;
    option.disabled = !tool.enabled;
    select.append(option);
  }
  select.value = current;
}

async function runDoctor() {
  const result = await api('doctor');
  const rows = result.checks.map((check) => {
    const label = { pass: '通过', fail: '失败', pending: '待处理' }[check.status] ?? check.status;
    return [esc(check.title), esc(label), esc(check.detail)];
  });
  $('#doctor-result').innerHTML = `<h2>体检</h2><div class="table-wrap">${table(
    ['检查项', '状态', '说明'],
    rows
  )}</div>`;
}

async function previewDeploy() {
  lastDeployTool = $('#deploy-tool').value;
  const params = { dryRun: true };
  if (lastDeployTool) params.tool = lastDeployTool;

  $('#uninstall-apply-box').hidden = true;
  pendingUninstall = null;

  const result = await api('deploy', params);
  $('#deploy-result').innerHTML = renderDeployPlan(result);
  $('#deploy-apply-box').hidden = false;
  $('#deploy-confirm').checked = false;
  $('#deploy-apply').disabled = true;
}

async function applyDeploy() {
  const params = { apply: true };
  if (lastDeployTool) params.tool = lastDeployTool;

  const result = await api('deploy', params, true);
  $('#deploy-result').innerHTML = renderDeployApplied(result);
  $('#deploy-apply-box').hidden = true;
  $('#uninstall-apply-box').hidden = true;
  pendingUninstall = null;
  await loadOverview();
}

async function previewUninstall() {
  clearError();
  lastDeployTool = $('#deploy-tool').value;
  const params = {};
  if (lastDeployTool) params.tool = lastDeployTool;

  const result = await api('uninstall', params);
  $('#uninstall-result').innerHTML = renderUninstall(result);
  $('#deploy-apply-box').hidden = true;

  const summary = result.summary;
  const removable =
    summary.deleteFile + summary.removeBlock + summary.skillsRemove + summary.globalRemove;
  const canForce = result.targets.some((target) => target.status === 'blocked' && target.canForce);
  if (removable > 0 || canForce) {
    pendingUninstall = { tool: lastDeployTool, canForce };
    $('#uninstall-target').textContent =
      `范围：${lastDeployTool || '全部工具'}；删除文件 ${summary.deleteFile}，移除块 ${summary.removeBlock}，移除技能 junction ${summary.skillsRemove}` +
      `${result.global?.status === 'remove-junction' ? '，移除全局脚本 junction' : ''}。`;
    $('#uninstall-force-row').hidden = !canForce;
    $('#uninstall-force').checked = false;
    $('#uninstall-confirm').checked = false;
    $('#uninstall-apply').disabled = true;
    $('#uninstall-apply-box').hidden = false;
  } else {
    pendingUninstall = null;
    $('#uninstall-apply-box').hidden = true;
  }
}

async function applyUninstall() {
  if (!pendingUninstall) throw new Error('请先预演要卸载的内容');
  const params = { apply: true, force: $('#uninstall-force').checked };
  if (pendingUninstall.tool) params.tool = pendingUninstall.tool;

  const result = await api('uninstall', params, true);
  $('#uninstall-result').innerHTML = renderUninstall(result);
  $('#uninstall-apply-box').hidden = true;
  pendingUninstall = null;
  await loadOverview();
}

function syncBackupApply() {
  const needsForce = pendingRestore?.needsForce === true;
  const forceOk = !needsForce || $('#backup-force').checked;
  $('#backup-apply').disabled = !($('#backup-confirm').checked && forceOk);
}

async function loadBackups() {
  clearError();
  const result = await api('backup', { positionals: ['list'] });
  $('#backup-table').innerHTML = renderBackupList(result);
  $('#backup-apply-box').hidden = true;
  $('#backup-prune-apply-box').hidden = true;
  pendingRestore = null;
  pendingPrune = null;
}

async function createBackups() {
  clearError();
  const result = await api('backup', { positionals: ['create'] }, true);
  $('#backup-create-result').innerHTML = renderBackupCreate(result);
  await loadBackups();
}

async function previewPrune() {
  clearError();
  $('#backup-apply-box').hidden = true;
  pendingRestore = null;
  const result = await api('backup', { positionals: ['prune'] });
  $('#backup-prune-result').innerHTML = renderBackupPrune(result);

  if (result.summary.delete > 0) {
    pendingPrune = { keep: result.keep };
    $('#backup-prune-target').textContent = `将删除 ${result.summary.delete} 份旧备份，每工具保留最近 ${result.keep} 份。`;
    $('#backup-prune-confirm').checked = false;
    $('#backup-prune-apply').disabled = true;
    $('#backup-prune-apply-box').hidden = false;
  } else {
    pendingPrune = null;
    $('#backup-prune-apply-box').hidden = true;
  }
}

async function applyPrune() {
  if (!pendingPrune) throw new Error('请先预演要清理的旧备份');
  const result = await api(
    'backup',
    { positionals: ['prune'], apply: true, keep: pendingPrune.keep },
    true
  );

  $('#backup-prune-result').innerHTML = renderBackupPrune(result);
  $('#backup-prune-apply-box').hidden = true;
  pendingPrune = null;
  await loadBackups();
}

async function previewRestore(tool, stamp) {
  clearError();
  $('#backup-prune-apply-box').hidden = true;
  pendingPrune = null;
  const result = await api('backup', { positionals: ['restore', tool, stamp] });
  $('#backup-result').innerHTML = renderBackupResult(result);

  const needsForce = result.status === 'blocked' && result.canForce === true;
  if (result.status === 'restore' || needsForce) {
    pendingRestore = { tool, stamp, needsForce };
    $('#backup-target').textContent = `待恢复：${result.tool.name} · ${stamp} · ${result.entryPath}`;
    $('#backup-force-row').hidden = !needsForce;
    $('#backup-force').checked = false;
    $('#backup-confirm').checked = false;
    $('#backup-apply-box').hidden = false;
    syncBackupApply();
  } else {
    pendingRestore = null;
    $('#backup-apply-box').hidden = true;
  }
}

async function applyRestore() {
  if (!pendingRestore) throw new Error('请先预览要恢复的备份');
  const force = pendingRestore.needsForce && $('#backup-force').checked;
  const result = await api(
    'backup',
    {
      positionals: ['restore', pendingRestore.tool, pendingRestore.stamp],
      apply: true,
      force
    },
    true
  );

  $('#backup-result').innerHTML = renderBackupResult(result);
  $('#backup-apply-box').hidden = true;
  pendingRestore = null;
  await loadBackups();
  $('#backup-result').innerHTML = renderBackupResult(result);
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      closeProjectPageSizeMenu();
      document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
      document.querySelectorAll('.page').forEach((page) => {
        page.hidden = page.id !== `page-${tab.dataset.page}`;
      });
      tab.classList.add('active');
      if (tab.dataset.page === 'backup') {
        $('#backup-create-result').innerHTML = '';
        $('#backup-prune-result').innerHTML = '';
        loadBackups().catch(showError);
      }
      if (tab.dataset.page === 'projects') {
        $('#project-apply-box').hidden = true;
        pendingProject = null;
        scanProjectList().catch(showError);
      }
      if (tab.dataset.page !== 'deploy') {
        $('#deploy-apply-box').hidden = true;
        $('#uninstall-apply-box').hidden = true;
        pendingUninstall = null;
      }
      if (tab.dataset.page !== 'projects') {
        $('#project-apply-box').hidden = true;
        pendingProject = null;
      }
    });
  });

  $('#refresh-overview').addEventListener('click', (event) => {
    withBusy(event.currentTarget, () => loadOverview()).catch(showError);
  });
  $('#run-doctor').addEventListener('click', (event) => {
    withBusy(event.currentTarget, runDoctor).catch(showError);
  });
  $('#deploy-preview').addEventListener('click', (event) => {
    withBusy(event.currentTarget, previewDeploy).catch(showError);
  });
  $('#deploy-confirm').addEventListener('change', (event) => {
    $('#deploy-apply').disabled = !event.currentTarget.checked;
  });
  $('#deploy-apply').addEventListener('click', (event) => {
    withBusy(event.currentTarget, applyDeploy).catch(showError);
  });
  $('#deploy-tool').addEventListener('change', () => {
    $('#deploy-apply-box').hidden = true;
    $('#uninstall-apply-box').hidden = true;
    pendingUninstall = null;
  });
  $('#uninstall-preview').addEventListener('click', (event) => {
    withBusy(event.currentTarget, previewUninstall).catch(showError);
  });
  $('#uninstall-confirm').addEventListener('change', (event) => {
    $('#uninstall-apply').disabled = !event.currentTarget.checked;
  });
  $('#uninstall-apply').addEventListener('click', (event) => {
    withBusy(event.currentTarget, applyUninstall).catch(showError);
  });

  $('#project-scan').addEventListener('click', (event) => {
    withBusy(event.currentTarget, scanProjectList).catch(showError);
  });
  $('#project-page-size').addEventListener('change', (event) => {
    const input = event.currentTarget;
    if (applyProjectPageSize(input.value) === null) {
      input.value = String(projectPageSize);
      return;
    }
    closeProjectPageSizeMenu();
  });
  $('#project-page-size-toggle').addEventListener('click', () => {
    toggleProjectPageSizeMenu();
  });
  $('#project-page-size-menu').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-project-page-size]');
    if (!button) return;
    applyProjectPageSize(button.dataset.projectPageSize);
    closeProjectPageSizeMenu();
    $('#project-page-size-toggle').focus();
  });
  $('.page-size-field').addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || $('#project-page-size-menu').hidden) return;
    event.preventDefault();
    closeProjectPageSizeMenu();
    $('#project-page-size-toggle').focus();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.page-size-field')) closeProjectPageSizeMenu();
  });
  $('#project-pagination').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-project-page]');
    if (!button || button.disabled) return;
    projectPage = Number(button.dataset.projectPage);
    renderProjectList();
  });
  $('#project-scan-result').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-project-path]');
    if (!button || !projectScanState) return;
    const project = projectScanState.projects.find(
      (item) => item.path === button.dataset.projectPath
    );
    if (project) openProjectDialog(project);
  });
  $('#project-dialog-close').addEventListener('click', () => {
    $('#project-dialog').close();
  });
  $('#project-dialog').addEventListener('click', (event) => {
    if (event.target === $('#project-dialog')) $('#project-dialog').close();
  });
  $('#project-dialog').addEventListener('close', () => {
    currentProject = null;
    pendingProject = null;
    $('#project-op-result').innerHTML = '';
    $('#project-apply-box').hidden = true;
    $('#project-force').checked = false;
  });
  $('#project-attach-preview').addEventListener('click', (event) => {
    withBusy(event.currentTarget, () => previewProject('attach')).catch(showError);
  });
  $('#project-detach-preview').addEventListener('click', (event) => {
    withBusy(event.currentTarget, () => previewProject('detach')).catch(showError);
  });
  for (const selector of ['#project-mode', '#project-force']) {
    $(selector).addEventListener('change', () => {
      $('#project-apply-box').hidden = true;
      pendingProject = null;
    });
  }
  $('#project-confirm').addEventListener('change', (event) => {
    $('#project-apply').disabled = !event.currentTarget.checked;
  });
  $('#project-apply').addEventListener('click', (event) => {
    withBusy(event.currentTarget, applyProject).catch(showError);
  });

  $('#backup-refresh').addEventListener('click', (event) => {
    withBusy(event.currentTarget, loadBackups).catch(showError);
  });
  $('#backup-create').addEventListener('click', (event) => {
    withBusy(event.currentTarget, createBackups).catch(showError);
  });
  $('#backup-prune').addEventListener('click', (event) => {
    withBusy(event.currentTarget, previewPrune).catch(showError);
  });
  $('#backup-prune-confirm').addEventListener('change', (event) => {
    $('#backup-prune-apply').disabled = !event.currentTarget.checked;
  });
  $('#backup-prune-apply').addEventListener('click', (event) => {
    withBusy(event.currentTarget, applyPrune).catch(showError);
  });
  $('#backup-table').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tool]');
    if (!button) return;
    withBusy(button, () => previewRestore(button.dataset.tool, button.dataset.stamp)).catch(
      showError
    );
  });
  $('#backup-force').addEventListener('change', syncBackupApply);
  $('#backup-confirm').addEventListener('change', syncBackupApply);
  $('#backup-apply').addEventListener('click', (event) => {
    withBusy(event.currentTarget, applyRestore).catch(showError);
  });
}

async function init() {
  $('#cli-hint').textContent =
    'CLI 等价命令：aiwb deploy / aiwb uninstall / aiwb scan / aiwb attach <项目路径> / aiwb detach <项目路径> / aiwb backup list / aiwb backup create / aiwb backup prune / aiwb backup restore';
  if (!token) {
    setConn(false, '缺少令牌');
    showError('地址缺少访问令牌，请使用 aiwb gui 输出的完整地址打开。');
    return;
  }

  bindEvents();
  try {
    await loadOverview();
  } catch (error) {
    setConn(false, '连接失败');
    showError(error);
  }
}

init();

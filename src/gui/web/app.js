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
let mergePlan = null;
let mergeValidated = null;
let settingsState = null;
let pendingSettings = null;
let settingsDirty = false;
let contentState = null;
let contentSelection = null;
let contentSaved = '';
let contentValidation = null;
let contentNewKind = 'rule';
let pendingContentCreate = null;
let contentReadToken = 0;
const customRemoved = new Set();
const CUSTOM_TOOL_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

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

const MERGE_BLOCK_LABELS = {
  present: '已有工作台块',
  absent: '没有工作台块',
  malformed: '块标记异常',
  unsupported: '无法读取'
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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const head = headers
    .map((header) => {
      if (typeof header === 'string') return `<th>${esc(header)}</th>`;
      const title = header.hint ? ` title="${esc(header.hint)}"` : '';
      return `<th${title}>${esc(header.label)}</th>`;
    })
    .join('');
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

function mergeStrategyLabel(strategy) {
  return strategy === 'separate-file' ? '独立文件（separate-file）' : '追加块（block-append）';
}

function mergeEntrySourceLabel(entry) {
  if (!entry.exists) return '入口文件不存在';
  if (entry.text === null) return `入口不是可写文本（${entry.encoding}）`;
  return `编码 ${entry.encoding}`;
}

function mergeEntryPlaceholder(entry) {
  if (!entry.exists) return '（入口文件不存在）';
  if (entry.text === null) return `（入口不是可写文本：${entry.encoding}）`;
  return '';
}

function fillMergeToolSelect(tools) {
  const select = $('#merge-tool');
  const current = select.value;
  select.innerHTML = '<option value="">选择工具</option>';
  for (const tool of tools) {
    if (!tool.enabled || (!tool.installed && !tool.custom)) continue;
    const option = document.createElement('option');
    option.value = tool.id;
    option.textContent = `${tool.name}（${mergeStrategyLabel(tool.strategy)}${
      tool.custom ? ' · 自定义' : ''
    }）`;
    select.append(option);
  }
  const stillListed = [...select.options].some((option) => option.value === current);
  if (stillListed) {
    select.value = current;
  } else if (current && mergePlan?.tool.id === current) {
    resetMergePage();
  }
  syncMergeLoadState();
}

function syncMergeLoadState() {
  $('#merge-load').disabled = !$('#merge-tool').value;
}

function syncMergeResetState() {
  const suggested = mergePlan?.suggested;
  $('#merge-reset').disabled =
    suggested === null || suggested === undefined || $('#merge-result').value === suggested;
}

async function refreshToolSelects() {
  const detect = await api('detect');
  fillToolSelect(detect.tools);
  fillMergeToolSelect(detect.tools);
}

function paintMergeMeta(result) {
  const entry = result.entry;
  const blockLabel = MERGE_BLOCK_LABELS[entry.blockStatus] ?? entry.blockStatus;
  const drift = entry.modifiedSinceDeploy ? ' · 与部署记录不一致（手改）' : '';
  $('#merge-meta').innerHTML = [
    `<div class="notice">${esc(result.tool.name)} · ${esc(
      mergeStrategyLabel(result.tool.strategy)
    )} · ${esc(mergeEntrySourceLabel(entry))}</div>`,
    `<p>入口：<code>${esc(entry.path)}</code></p>`,
    `<p>当前块：${esc(blockLabel)}${esc(drift)}</p>`,
    entry.blockReason ? `<p class="hint">${esc(entry.blockReason)}</p>` : '',
    `<p class="hint">${esc(result.reason)}</p>`
  ]
    .filter(Boolean)
    .join('');

  const value = (hash) => (hash ? `<code>${esc(hash)}</code>` : '（无）');
  $('#merge-details').innerHTML = [
    ['入口文件哈希', entry.fileHash],
    ['当前块哈希', entry.currentBlockHash],
    ['部署记录块哈希', entry.storedBlockHash],
    ['工作台内容哈希', result.workbench.contentHash],
    ['工作台块哈希', result.workbench.blockHash],
    ['预演入口哈希', result.expected.fileHash],
    ['预演构建哈希', result.expected.buildHash]
  ]
    .map(([label, hash]) => `<p>${esc(label)}：${value(hash)}</p>`)
    .join('');
}

function paintMergeIssues(result) {
  const warnings = result.warnings ?? [];
  const issues = result.issues ?? [];
  if (warnings.length === 0 && issues.length === 0) {
    $('#merge-issues').innerHTML = '';
    return;
  }

  const list = (items) =>
    `<ul class="list">${items
      .map((item) => `<li>${esc(item.message ?? item)}</li>`)
      .join('')}</ul>`;
  $('#merge-issues').innerHTML = [
    '<div class="notice warn">',
    warnings.length > 0 ? `<p><strong>提醒</strong></p>${list(warnings)}` : '',
    issues.length > 0 ? `<p><strong>阻止</strong></p>${list(issues)}` : '',
    '</div>'
  ].join('');
}

function mergeValidationHtml(validation) {
  if (!validation) return '';
  return validation.ok
    ? '<p class="notice ok">校验通过：仅工作台块正文变化，块外原文保持原样。</p>'
    : `<div class="notice warn"><strong>校验未通过</strong><ul class="list">${validation.issues
        .map((issue) => `<li>${esc(issue.message)}</li>`)
        .join('')}</ul></div>`;
}

function renderMergePlan(result) {
  mergePlan = result;
  mergeValidated = null;
  const entry = result.entry;

  $('#merge-existing').value = entry.text ?? '';
  $('#merge-existing').placeholder = mergeEntryPlaceholder(entry);
  $('#merge-workbench').value = result.workbench.content;
  $('#merge-result').value = result.suggested ?? '';
  $('#merge-result').readOnly = result.suggested === null;
  syncMergeResetState();
  $('#merge-validate').disabled = result.suggested === null;
  $('#merge-confirm').checked = false;
  $('#merge-apply').disabled = true;
  $('#merge-apply-box').hidden = true;
  $('#merge-validation').innerHTML = '';
  $('#merge-result-status').innerHTML = '';
  paintMergeMeta(result);
  paintMergeIssues(result);
}

function resetMergePage() {
  mergePlan = null;
  mergeValidated = null;
  $('#merge-existing').value = '';
  $('#merge-existing').placeholder = '';
  $('#merge-workbench').value = '';
  $('#merge-result').value = '';
  $('#merge-result').readOnly = false;
  syncMergeResetState();
  $('#merge-validate').disabled = true;
  $('#merge-confirm').checked = false;
  $('#merge-apply').disabled = true;
  $('#merge-apply-box').hidden = true;
  $('#merge-meta').innerHTML = '<p class="hint">选择工具后点击“加载预演”。</p>';
  $('#merge-details').innerHTML = '';
  $('#merge-issues').innerHTML = '';
  $('#merge-validation').innerHTML = '';
  $('#merge-result-status').innerHTML = '';
  syncMergeLoadState();
}

function resetMergeResult() {
  if (!mergePlan?.suggested) return;
  $('#merge-result').value = mergePlan.suggested;
  mergeValidated = null;
  $('#merge-confirm').checked = false;
  $('#merge-apply').disabled = true;
  $('#merge-apply-box').hidden = true;
  $('#merge-result-status').innerHTML = '';
  $('#merge-validation').innerHTML = '<p class="hint">已恢复为工作台建议内容，请重新校验。</p>';
  syncMergeResetState();
}

function handleMergeEdit() {
  mergeValidated = null;
  $('#merge-confirm').checked = false;
  $('#merge-apply').disabled = true;
  $('#merge-apply-box').hidden = true;
  $('#merge-result-status').innerHTML = '';
  $('#merge-validation').innerHTML = '<p class="hint">内容已修改，请重新校验；未校验不会写入。</p>';
  syncMergeResetState();
}

async function loadMergePreview() {
  clearError();
  const tool = $('#merge-tool').value;
  if (!tool) throw new Error('请先选择要合并的目标工具');
  const result = await api('merge', { tool });
  renderMergePlan(result);
  setConn(true, '已连接');
}

async function validateMerge() {
  clearError();
  if (!mergePlan) throw new Error('请先加载合并预演');
  const content = $('#merge-result').value;
  if (!content) throw new Error('合并结果为空，请先加载预演或填写内容');

  const result = await api('merge', { tool: mergePlan.tool.id, content });
  mergePlan = result;
  mergeValidated = null;

  const entry = result.entry;
  $('#merge-existing').value = entry.text ?? '';
  $('#merge-existing').placeholder = mergeEntryPlaceholder(entry);
  $('#merge-result').readOnly = false;
  syncMergeResetState();
  $('#merge-validate').disabled = result.suggested === null;
  $('#merge-result-status').innerHTML = '';
  paintMergeMeta(result);
  paintMergeIssues(result);
  $('#merge-validation').innerHTML = mergeValidationHtml(result.validation);

  if (result.canApply) {
    mergeValidated = {
      content,
      fileHash: result.expected.fileHash,
      buildHash: result.expected.buildHash
    };
    $('#merge-apply-target').textContent = `写入：${result.tool.name} · ${result.entry.path}。写入前会备份当前入口。`;
    $('#merge-confirm').checked = false;
    $('#merge-apply').disabled = true;
    $('#merge-apply-box').hidden = false;
  } else {
    $('#merge-apply-box').hidden = true;
    if (!result.validation || result.validation.ok) {
      $('#merge-validation').innerHTML +=
        '<p class="hint">当前状态下不能写入；按上面的阻止原因处理后再试。</p>';
    }
  }
}

async function applyMerge() {
  clearError();
  if (!mergePlan) throw new Error('请先加载合并预演');
  if (!mergeValidated) throw new Error('请先校验合并结果');

  const content = $('#merge-result').value;
  if (content !== mergeValidated.content) {
    throw new Error('合并结果已变化，请重新校验');
  }

  const params = { tool: mergePlan.tool.id, content, apply: true };
  if (mergeValidated.fileHash) params.expectedFileHash = mergeValidated.fileHash;
  if (mergeValidated.buildHash) params.expectedBuildHash = mergeValidated.buildHash;

  const result = await api('merge', params, true);
  mergePlan = result;
  mergeValidated = null;
  $('#merge-confirm').checked = false;
  $('#merge-apply').disabled = true;
  $('#merge-apply-box').hidden = true;

  const entry = result.entry;
  $('#merge-existing').value = entry.text ?? '';
  $('#merge-existing').placeholder = mergeEntryPlaceholder(entry);
  paintMergeMeta(result);
  paintMergeIssues(result);
  $('#merge-validation').innerHTML = mergeValidationHtml(result.validation);

  if (result.applied) {
    $('#merge-result').value = result.merged.content;
    $('#merge-result').readOnly = true;
    $('#merge-reset').disabled = true;
    $('#merge-validate').disabled = true;
    $('#merge-result-status').innerHTML = [
      '<div class="notice ok"><strong>合并已写入</strong>',
      `<p>备份：${
        result.backup ? `<code>${esc(result.backup)}</code>` : '（原文件不存在，无需备份）'
      }</p>`,
      `<p>写入后文件哈希：<code>${esc(result.merged.fileHash)}</code></p></div>`
    ].join('');
    await loadOverview();
    return;
  }

  $('#merge-result-status').innerHTML = `<div class="notice warn">未写入：${esc(
    result.reason
  )}</div>`;
  $('#merge-result').readOnly = result.suggested === null;
  $('#merge-validate').disabled = result.suggested === null;
  syncMergeResetState();
  await loadOverview();
}

function invalidateMergeApply() {
  if (!mergeValidated) return;
  mergeValidated = null;
  $('#merge-confirm').checked = false;
  $('#merge-apply').disabled = true;
  $('#merge-apply-box').hidden = true;
  $('#merge-validation').innerHTML = '<p class="hint">已离开合并页，写入前请重新校验。</p>';
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

const PROJECT_MODE_HINTS = {
  auto:
    'auto 写 AGENTS.md：入口未跟踪时创建、追加或更新工作台块，并把入口加入本机 .git/info/exclude；入口已跟踪时阻止写入，避免悄悄改动团队文件，此时改用 append，或改用 AGENTS.local.md 未被跟踪的 local。',
  local:
    'local 写 AGENTS.local.md：入口未跟踪时创建、追加或更新工作台块，并把入口加入本机 .git/info/exclude；不改已跟踪的 AGENTS.md。若 AGENTS.local.md 自身已被跟踪，同样阻止写入。只有明确读取该文件的工具会生效（Qoder 支持，其他工具不一定），需要跨工具注入时用 append。',
  append:
    'append 写 AGENTS.md：即使入口已被 git 跟踪也允许创建、追加或更新工作台块；改动会出现在 git 变更中，需要你决定是否提交。append 只放开跟踪限制，不会覆盖已被手改的块。'
};

function updateProjectModeHint() {
  $('#project-mode-hint').textContent = PROJECT_MODE_HINTS[$('#project-mode').value] ?? '';
}

function projectTrackedNotice(plan) {
  if (plan.mode === 'local') {
    return '入口已被 git 跟踪；local 不会改写该文件，append 改为写 AGENTS.md。';
  }
  if (plan.mode === 'append') {
    return '入口已被 git 跟踪；append 允许写入，改动会进入 git 变更。';
  }
  return '入口已被 git 跟踪；auto 不会改写，改用 append 或未被跟踪的 AGENTS.local.md。';
}

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
      [
        {
          label: '项目',
          hint: '项目名称；名称来自机器档案项目清单，未登记时使用目录名。'
        },
        {
          label: '状态',
          hint:
            '当前挂载状态：未挂载、已挂载、指针待更新、块被手改、块缺失、入口缺失、有块无记录、文件已跟踪、目录缺失、编码不支持或块标记异常；其中“文件已跟踪”表示入口已进入 git 索引且尚未挂载，auto/local 不会改写，汇总中的“入口已跟踪”就是这一类，需要 append，或改用 AGENTS.local.md 未被跟踪的 local；“目录缺失”“编码不支持”“块标记异常”分别表示项目目录不存在、入口不是可读 UTF-8、工作台块标记损坏。'
        },
        {
          label: '入口',
          hint:
            '工作台使用的项目入口文件：auto 和 append 写 AGENTS.md，local 写 AGENTS.local.md；选择方式前先看“入口跟踪”列。'
        },
        {
          label: '记录',
          hint: '本机部署状态中是否记录该项目挂载；取消挂载时需要记录来判断块和入口文件归属。'
        },
        {
          label: 'Git 仓库',
          hint: '项目自身是否为 git 工作区；工作树或子模块的 .git 文件显示为“工作树/子模块”。'
        },
        {
          label: '入口跟踪',
          hint:
            '入口文件是否已在项目的 git 索引中。已跟踪时 auto 会阻止写入，避免悄悄改动团队文件；改用 append 可写入并使改动进入 git 变更，或改用 local 写 AGENTS.local.md（该文件自身也须未被跟踪；仅明确读取该文件的工具生效，且不会改动已跟踪的 AGENTS.md）。'
        },
        {
          label: '本地忽略',
          hint:
            '项目 .git/info/exclude 是否含入口忽略行；只在本机生效，不会提交，也不修改 .gitignore。exclude 只对未跟踪文件有效，入口已跟踪时不会因此隐藏改动。'
        },
        {
          label: '路径',
          hint: '项目绝对路径；工作台只处理机器档案允许范围内的项目。'
        },
        {
          label: '操作',
          hint:
            '打开该项目的操作弹层，选择挂载方式、预演并确认执行挂载或取消挂载；入口已跟踪时在弹层里选 append，或选 local 写未被跟踪的 AGENTS.local.md。'
        }
      ],
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
      ? `<p class="notice${plan.status === 'blocked' ? ' warn' : ''}">${esc(
          projectTrackedNotice(plan)
        )}</p>`
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
  updateProjectModeHint();
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
  fillMergeToolSelect(detect.tools);
}

function fillToolSelect(tools) {
  const select = $('#deploy-tool');
  const current = lastDeployTool;
  select.innerHTML = '<option value="">全部</option>';
  for (const tool of tools) {
    const option = document.createElement('option');
    option.value = tool.id;
    const suffix = !tool.enabled
      ? tool.custom
        ? '（已停用）'
        : '（预留）'
      : tool.custom
        ? '（自定义）'
        : '';
    option.textContent = `${tool.name}${suffix}`;
    option.disabled = !tool.enabled;
    select.append(option);
  }
  if ([...select.options].some((option) => option.value === current && !option.disabled)) {
    select.value = current;
  } else if (current) {
    lastDeployTool = '';
  }
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
  $('#backup-prune').disabled = true;
  const result = await api('backup', { positionals: ['list'] });
  $('#backup-table').innerHTML = renderBackupList(result);
  $('#backup-prune').disabled = result.backups.length === 0;
  $('#backup-apply-box').hidden = true;
  $('#backup-prune-apply-box').hidden = true;
  pendingRestore = null;
  pendingPrune = null;
}

const HISTORY_ACTION_LABELS = {
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

const HISTORY_RESULT_LABELS = {
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

const HISTORY_DRIFT_STATES = new Set([
  'drift',
  'stale',
  'missing',
  'missing-block',
  'unmanaged',
  'build-error',
  'unsupported-encoding',
  'unreadable'
]);

async function loadHistory() {
  clearError();
  const limit = Number($('#history-limit').value) || 50;
  const [log, status] = await Promise.all([api('log', { limit }), api('status')]);
  setConn(true, '已连接');
  renderHistorySummary(log);
  renderHistoryDeploy(log);
  renderHistoryDrift(status);
  renderHistoryLog(log);
}

function renderHistorySummary(log) {
  const files =
    log.files.length > 0
      ? log.files.map((file) => `${file.name}（${file.entries} 条）`).join('、')
      : '暂无日志文件';
  const limitText = log.truncated
    ? `显示最近 ${log.entries.length} 条（上限 ${log.limit}）`
    : `显示 ${log.entries.length} 条`;
  const issues =
    log.issues.length > 0
      ? `<p class="notice bad">有 ${log.issues.length} 行日志无法解析，已跳过；明细见“操作记录”末尾。</p>`
      : '';
  $('#history-summary').innerHTML = `<div class="notice">日志：<code>${esc(
    log.logsDir
  )}</code> · ${esc(files)}<br>共 ${log.total} 条，${esc(limitText)} · 部署记录 ${
    log.deploy.targets.length
  } 个目标 / ${log.deploy.projects.length} 个项目${
    log.deploy.lastRun ? ` · 上次运行 ${esc(log.deploy.lastRun)}` : ''
  }</div>${issues}`;
}

function renderHistoryDeploy(log) {
  const parts = ['<h2>部署记录</h2>'];
  if (log.deploy.targets.length === 0) {
    parts.push('<p class="hint">当前没有工具部署记录。执行部署成功后，记录会出现在这里。</p>');
  } else {
    const rows = log.deploy.targets.map((target) => [
      esc(target.tool),
      esc(historyDeployActionLabel(target.action)),
      esc(target.deployedAt ?? '—'),
      `<code>${esc(hashShort(target.contentHash))}</code>`,
      target.manualMerge ? '是' : '否',
      target.backup ? `<code>${esc(target.backup)}</code>` : '—'
    ]);
    parts.push(
      `<div class="table-wrap">${table(
        ['工具', '动作', '部署时间', '内容哈希', '手工合并', '备份'],
        rows
      )}</div>`
    );
  }

  if (log.deploy.projects.length > 0) {
    const rows = log.deploy.projects.map((project) => [
      `<code>${esc(project.projectPath)}</code>`,
      esc(project.mode ?? '—'),
      project.file ? `<code>${esc(project.file)}</code>` : '—',
      esc(project.attachedAt ?? '—')
    ]);
    parts.push(
      '<h2>项目记录</h2>',
      `<div class="table-wrap">${table(['项目', '方式', '入口', '挂载时间'], rows)}</div>`
    );
  }

  $('#history-deploy').innerHTML = parts.join('');
}

function renderHistoryDrift(status) {
  const drift = status.targets.filter((target) => HISTORY_DRIFT_STATES.has(target.state));
  const parts = ['<h2>漂移与待处理</h2>'];
  if (drift.length === 0) {
    parts.push('<p class="hint">没有发现漂移、缺失或待更新项。</p>');
  } else {
    const rows = drift.map((target) => [
      esc(target.name),
      esc(target.label),
      target.recorded ? '有' : '无',
      `<code>${esc(target.entryPath)}</code>`
    ]);
    parts.push(
      `<p class="hint">共 ${drift.length} 项需要关注：漂移表示入口被手改；待更新表示内容已变但入口还没重新部署；缺失表示入口或工作台块不见了。</p>`,
      `<div class="table-wrap">${table(['工具', '状态', '部署记录', '入口'], rows)}</div>`
    );
  }
  $('#history-drift').innerHTML = parts.join('');
}

function renderHistoryLog(log) {
  const parts = ['<h2>操作记录</h2>'];
  if (log.entries.length === 0) {
    parts.push(
      '<p class="hint">暂无操作记录。部署、合并、备份、恢复、卸载、项目挂载、设置或内容写入成功后会写入这里；预演不记录。</p>'
    );
  } else {
    const rows = log.entries.map((entry) => [
      esc(entry.at),
      esc(HISTORY_ACTION_LABELS[entry.action] ?? entry.action),
      entry.source === 'gui' ? 'GUI' : 'CLI',
      `<code>${esc(entry.target ?? entry.tool ?? '—')}</code>`,
      esc(historyResultLabel(entry)),
      entry.backup ? `<code>${esc(entry.backup)}</code>` : '—'
    ]);
    parts.push(
      `<div class="table-wrap">${table(
        ['时间', '动作', '来源', '目标', '结果', '备份'],
        rows
      )}</div>`
    );
  }

  if (log.issues.length > 0) {
    const rows = log.issues
      .slice(0, 20)
      .map((issue) => [esc(issue.file), esc(issue.line ?? '—'), esc(issue.message)]);
    parts.push(
      '<h3>无法解析的日志行</h3>',
      `<div class="table-wrap">${table(['文件', '行', '说明'], rows)}</div>`
    );
  }

  $('#history-log').innerHTML = parts.join('');
}

function historyResultLabel(entry) {
  const label = HISTORY_RESULT_LABELS[entry.result] ?? entry.result;
  return entry.detail?.error ? `${label}：${entry.detail.error}` : label;
}

function historyDeployActionLabel(action) {
  return (
    {
      'create-file': '新建',
      'append-block': '追加',
      'update-block': '更新',
      unchanged: '无变化',
      'manual-merge': '手工合并',
      restored: '已恢复'
    }[action] ??
    action ??
    '—'
  );
}

async function loadDiagnosePage() {
  clearError();
  const [status, log, doctor] = await Promise.all([
    api('status'),
    api('log', { limit: 20 }),
    api('doctor')
  ]);
  setConn(true, '已连接');
  renderDiagnoseSummary(status, log, doctor);
  renderDiagnoseTargets(status);
  renderDiagnosePaths(status, log);
  renderDiagnoseLog(log);
  $('#diagnose-result').innerHTML = '';
  $('#diagnose-confirm').checked = false;
  $('#diagnose-generate').disabled = true;
  $('#diagnose-confirm-box').hidden = false;
}

function renderDiagnoseSummary(status, log, doctor) {
  const health = diagnoseHealthText(doctor);
  const logText = `${log.total} 条记录${
    log.truncated ? `，本次显示最近 ${log.entries.length} 条` : ''
  }${log.issues.length > 0 ? `；${log.issues.length} 行无法解析` : ''}`;
  $('#diagnose-summary').innerHTML = [
    '<h2>当前状态</h2>',
    `<div class="notice${doctor.ok ? ' ok' : ' bad'}">构建内容哈希：<code>${esc(
      status.build.contentHash ?? '（无）'
    )}</code>${status.build.generatedAt ? `，生成于 ${esc(status.build.generatedAt)}` : ''}${
      status.build.error ? `；清单错误：${esc(status.build.error)}` : ''
    }<br>部署状态：${esc(diagnoseDeployText(status.summary))}<br>体检：${esc(
      health
    )}<br>日志：${esc(logText)}</div>`
  ].join('');
}

function renderDiagnoseTargets(status) {
  const rows = status.targets.map((target) => [
    esc(target.name),
    esc(target.label),
    target.recorded ? '有' : '无',
    `<code>${esc(hashShort(target.deployedContentHash))}</code>`,
    `<code>${esc(target.entryPath)}</code>`
  ]);
  $('#diagnose-targets').innerHTML = [
    '<h2>入口与哈希</h2>',
    `<div class="table-wrap">${table(
      [
        { label: '工具' },
        { label: '状态', hint: '入口当前状态；待更新表示内容已变但入口还没重新部署，漂移表示入口被手改。' },
        { label: '部署记录' },
        { label: '部署内容哈希', hint: '部署时记录的构建内容哈希；与上方构建内容哈希不同表示入口待更新。' },
        { label: '入口', hint: '按当前机器档案展开后的绝对路径；诊断包只记录路径，不读取入口正文。' }
      ],
      rows
    )}</div>`
  ].join('');
}

function renderDiagnosePaths(status, log) {
  const rows = [
    ['机器档案', status.machine.filePath],
    ['全局工作台根目录', status.global.globalRoot ?? '（未配置）'],
    ['全局脚本入口', status.global.linkPath ?? '（未配置）']
  ];
  for (const project of log.deploy.projects) {
    rows.push([
      `项目 ${project.projectPath}`,
      project.file ? `${project.file}（${project.mode ?? '未知方式'}）` : '（无入口记录）'
    ]);
  }
  $('#diagnose-paths').innerHTML = [
    '<h2>路径清单</h2>',
    `<p class="hint">工具入口路径见上表；这里列出机器档案、全局工作台与已挂载项目。诊断包中的 paths.json 还会记录内容目录、日志、备份与技能目录是否存在。</p>`,
    `<div class="table-wrap">${table(['对象', '路径'], rows.map((row) => [esc(row[0]), `<code>${esc(row[1])}</code>`]))}</div>`
  ].join('');
}

function renderDiagnoseLog(log) {
  const files =
    log.files.length > 0
      ? log.files.map((file) => `${file.name}（${file.entries} 条）`).join('、')
      : '暂无日志文件';
  $('#diagnose-log').innerHTML = [
    '<h2>操作日志</h2>',
    `<div class="notice">日志目录：<code>${esc(log.logsDir)}</code><br>${esc(
      files
    )}<br>共 ${log.total} 条${
      log.truncated ? `，本次显示最近 ${log.entries.length} 条（上限 ${log.limit}）` : ''
    }${log.issues.length > 0 ? `；${log.issues.length} 行无法解析` : ''}</div>`
  ].join('');
}

async function generateDiagnose() {
  clearError();
  const result = await api('diagnose', { zip: true }, true);
  $('#diagnose-result').innerHTML = renderDiagnoseResult(result);
  $('#diagnose-confirm').checked = false;
  $('#diagnose-generate').disabled = true;
}

function renderDiagnoseResult(result) {
  const parts = [
    '<h2>生成结果</h2>',
    `<p class="notice ok">诊断包已生成：<code>${esc(result.outputDir)}</code>${
      result.zip
        ? `<br>zip：<code>${esc(result.zip.path)}</code>（${esc(formatBytes(result.zip.bytes))}）`
        : ''
    }</p>`,
    `<p class="hint">体检：${esc(diagnoseHealthText(result.health))}；部署状态：${esc(
      diagnoseDeployText(result.summary.deploy)
    )}；日志：${result.summary.log.total ?? '不可用'}${
      result.summary.log.error ? `（${esc(result.summary.log.error)}）` : ' 条'
    }。</p>`,
    `<div class="table-wrap">${table(
      ['包内文件', '大小'],
      result.files.map((file) => [`<code>${esc(file.name)}</code>`, esc(formatBytes(file.bytes))])
    )}</div>`,
    '<p class="hint">包内包含本机路径与主机名；不含机器档案正文、环境变量值、内容正文、令牌或密钥。发送前请先打开 README.md 复核。</p>'
  ];

  if (result.issues.length > 0) {
    parts.push(
      `<h3>打包时发现的问题</h3><div class="table-wrap">${table(
        ['范围', '说明'],
        result.issues.slice(0, 15).map((issue) => [esc(issue.section), esc(issue.message)])
      )}</div>`
    );
    if (result.issues.length > 15) {
      parts.push(`<p class="hint">其余 ${result.issues.length - 15} 项从略。</p>`);
    }
  }

  return parts.join('');
}

function diagnoseHealthText(health) {
  if (!health) return '不可用';
  if (health.error) return `不可用（${health.error}）`;
  const counts = Array.isArray(health.checks)
    ? {
        pass: health.checks.filter((check) => check.status === 'pass').length,
        pending: health.checks.filter((check) => check.status === 'pending').length,
        fail: health.checks.filter((check) => check.status === 'fail').length
      }
    : health;
  return `${health.ok ? '通过' : '未通过'}（通过 ${counts.pass}，待处理 ${counts.pending}，失败 ${counts.fail}）`;
}

function diagnoseDeployText(value) {
  if (value?.error) return `不可用（${value.error}）`;
  const summary = value?.summary ?? value;
  if (!summary || typeof summary.ok !== 'number') return '不可用';
  return `正常 ${summary.ok}，待更新 ${summary.stale}，漂移 ${summary.drift}，缺失 ${summary.missing}，未部署 ${summary.notDeployed}，未安装 ${summary.notInstalled}，预留 ${summary.disabled}，其他 ${summary.manual}`;
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

const SETTINGS_CHANGE_LABELS = {
  set: '新增',
  update: '修改',
  unset: '删除',
  unchanged: '无变化'
};

async function loadSettingsPage() {
  const result = await api('settings', { positionals: ['show'] });
  settingsState = result;
  pendingSettings = null;
  paintSettingsShow(result);
}

function paintSettingsShow(result) {
  $('#settings-file').textContent = result.filePath ?? '（机器档案不可用）';
  $('#settings-custom-add').disabled = !result.available || !result.writable;
  $('#settings-status').innerHTML = settingsStatusHtml(result);
  $('#settings-retention').value = result.backupRetention.value;
  $('#settings-gui-port').value = result.guiPort.value;
  customRemoved.clear();
  renderSettingsEnv(result.env);
  renderSettingsTools(result);
  renderSettingsCustomTools(result.customTools ?? {});
  $('#settings-plan').innerHTML = '';
  $('#settings-result').innerHTML = '';
  $('#settings-confirm').checked = false;
  $('#settings-apply').disabled = true;
  $('#settings-apply-box').hidden = true;
  setSettingsDirty(false);
}

function settingsStatusHtml(result) {
  const blocks = [];
  if (!result.available) {
    blocks.push('<p class="notice bad">机器档案不可用，无法查看或修改设置；请先按 machines/_template.md 创建本机档案。</p>');
  } else if (!result.writable) {
    blocks.push(`<p class="notice bad">机器档案编码为 ${esc(result.encoding)}，设置页不会写入；请先转换为 UTF-8。</p>`);
  } else if (result.issues.length > 0) {
    blocks.push(
      `<p class="notice bad">设置存在 ${result.issues.length} 个问题，写入会被阻止：${result.issues
        .map((issue) => esc(`${issue.key}：${issue.message}`))
        .join('；')}</p>`
    );
  } else {
    blocks.push('<p class="notice ok">设置已加载；修改先预演，确认后再写入本机机器档案。</p>');
  }
  if (result.targetsError) {
    blocks.push(`<p class="notice bad">工具路径无法解析：${esc(result.targetsError)}</p>`);
  }
  return blocks.join('');
}

function renderSettingsEnv(env) {
  const container = $('#settings-env-rows');
  const entries = Object.entries(env);
  container.innerHTML = entries
    .map(
      ([name, value]) => `<div class="env-row">
        <input data-env-name aria-label="环境变量名" placeholder="变量名" value="${esc(name)}" />
        <input data-env-value aria-label="环境变量值" placeholder="值" value="${esc(value)}" />
        <button type="button" class="small" data-env-remove>删除</button>
      </div>`
    )
    .join('');
}

function appendSettingsEnvRow(name = '', value = '') {
  const row = document.createElement('div');
  row.className = 'env-row';
  row.innerHTML = `
    <input data-env-name aria-label="环境变量名" placeholder="变量名" value="${esc(name)}" />
    <input data-env-value aria-label="环境变量值" placeholder="值" value="${esc(value)}" />
    <button type="button" class="small" data-env-remove>删除</button>
  `;
  $('#settings-env-rows').append(row);
  row.querySelector('[data-env-name]').focus();
}

function renderSettingsTools(result) {
  const container = $('#settings-tools');
  if (result.tools.length === 0) {
    container.innerHTML = '<p class="muted">目标注册表不可用，无法编辑工具覆盖。</p>';
    return;
  }

  const builtInTools = result.tools.filter((tool) => !tool.custom);
  if (builtInTools.length === 0) {
    container.innerHTML = '<p class="muted">注册表里没有内置工具。</p>';
    return;
  }

  container.innerHTML = builtInTools
    .map((tool) => {
      const overrides = tool.overrides ?? {};
      const enabledValue =
        overrides.enabled === true ? 'true' : overrides.enabled === false ? 'false' : '';
      const enabledLabel = overrides.enabled === null ? '' : '（已覆盖）';
      const installState = tool.installed ? '已安装' : '未安装';
      const entryState = tool.entryExists
        ? tool.usingFallback
          ? '入口存在（备选路径）'
          : '入口存在'
        : '入口不存在';
      const skillsState = !tool.skillsDir
        ? '未配置技能目录'
        : tool.skillsDirExists
          ? '技能目录存在'
          : '技能目录不存在';
      const overrideCount = Object.values(overrides).filter(
        (value) => value !== null && value !== undefined
      ).length;
      return `<section class="settings-tool" data-tool-id="${esc(tool.id)}">
        <div class="settings-tool-head">
          <h3>${esc(tool.name)} <span class="muted">${esc(tool.id)}</span></h3>
          <span class="badge">${installState} · ${entryState} · ${skillsState}${
            overrideCount > 0 ? ` · ${overrideCount} 项覆盖` : ''
          }</span>
        </div>
        <div class="settings-tool-grid">
          <label class="settings-field">
            启用${enabledLabel}
            <select data-setting-field="enabled">
              <option value=""${enabledValue === '' ? ' selected' : ''}>继承注册表（当前${
                tool.enabled ? '启用' : '停用'
              }）</option>
              <option value="true"${enabledValue === 'true' ? ' selected' : ''}>启用</option>
              <option value="false"${enabledValue === 'false' ? ' selected' : ''}>停用</option>
            </select>
          </label>
          <label class="settings-field">
            配置目录
            <input data-setting-field="configRoot" value="${esc(overrides.configRoot ?? '')}" placeholder="${esc(tool.configRoot)}" />
          </label>
          <label class="settings-field">
            入口文件
            <input data-setting-field="entryPath" value="${esc(overrides.entryPath ?? '')}" placeholder="${esc(tool.entryPath)}" />
          </label>
          <label class="settings-field">
            技能目录
            <input data-setting-field="skillsDir" value="${esc(overrides.skillsDir ?? '')}" placeholder="${esc(tool.skillsDir ?? '未配置')}" />
          </label>
        </div>
        <p class="hint">默认配置目录：${esc(tool.configRoot)}；默认入口：${esc(tool.entryPath)}。入口覆盖后不再尝试备选路径。</p>
      </section>`;
    })
    .join('');
}

function customToolCard(id, tool, isNew) {
  const enabled = tool.enabled !== false;
  const strategy = tool.strategy === 'separate-file' ? 'separate-file' : 'block-append';
  const format = tool.format === 'mdc' ? 'mdc' : 'markdown';
  const idField = isNew
    ? `<input data-custom-field="id" value="${esc(id)}" placeholder="例如 my-tool"
        title="小写字母、数字和短横线，最长 40 个字符；加入列表和点“预演修改”时都会校验，保存后不可修改。" />`
    : `<input data-custom-field="id" value="${esc(id)}" readonly
        title="工具 id 保存后不可修改；需要改名时先删除该工具并写入，再重新添加。" />`;

  return `<section class="settings-custom-tool settings-tool" ${
    isNew ? 'data-new="true"' : `data-tool-id="${esc(id)}"`
  }>
    <div class="settings-tool-head">
      <h3>${esc(tool.name || '未命名工具')} <span class="muted">${esc(id || '新工具')}</span></h3>
      <div class="custom-head-actions">
        <span class="badge" data-custom-state>${isNew ? '未保存' : '已保存'}</span>
        <button type="button" class="small" data-custom-remove>${
          isNew ? '移除' : '删除'
        }</button>
      </div>
    </div>
    <div class="settings-tool-grid">
      <label class="settings-field">
        工具 id
        ${idField}
      </label>
      <label class="settings-field">
        显示名称
        <input data-custom-field="name" value="${esc(tool.name ?? '')}" placeholder="例如 My Tool" />
      </label>
      <label class="settings-field">
        配置目录
        <input data-custom-field="configRoot" value="${esc(tool.configRoot ?? '')}"
          placeholder="例如 %APPDATA%\\MyTool" />
      </label>
      <label class="settings-field">
        入口文件
        <input data-custom-field="entryPath" value="${esc(tool.entryPath ?? '')}"
          placeholder="例如 %APPDATA%\\MyTool\\AGENTS.md" />
      </label>
      <label class="settings-field">
        写入方式
        <select data-custom-field="strategy"
          title="追加块只改写入口里的工作台块；独立文件要求入口整篇由工作台维护。">
          <option value="block-append"${strategy === 'block-append' ? ' selected' : ''}>追加块（block-append）</option>
          <option value="separate-file"${strategy === 'separate-file' ? ' selected' : ''}>独立文件（separate-file）</option>
        </select>
      </label>
      <label class="settings-field">
        入口格式
        <select data-custom-field="format"
          title="入口内容的格式；mdc 通常用于支持 frontmatter 的规则文件。">
          <option value="markdown"${format === 'markdown' ? ' selected' : ''}>markdown</option>
          <option value="mdc"${format === 'mdc' ? ' selected' : ''}>mdc</option>
        </select>
      </label>
      <label class="settings-field">
        技能目录（可选）
        <input data-custom-field="skillsDir" value="${esc(tool.skillsDir ?? '')}"
          placeholder="留空表示不接入技能 junction" />
      </label>
      <label class="settings-field">
        启用
        <select data-custom-field="enabled">
          <option value="true"${enabled ? ' selected' : ''}>启用</option>
          <option value="false"${enabled ? '' : ' selected'}>停用</option>
        </select>
      </label>
    </div>
    <label class="settings-field custom-frontmatter">
      frontmatter（可选，仅独立文件生效）
      <textarea data-custom-field="frontmatter" spellcheck="false"
        placeholder="---&#10;description: 本工具的项目规则入口&#10;---">${esc(
          tool.frontmatter ?? ''
        )}</textarea>
    </label>
    <p class="hint">部署时即使配置目录不存在，也会按入口与技能目录创建父目录后写入；技能目录留空则不建立 junction。这里只登记本机定义，不会提交到仓库。</p>
    <p class="custom-removed-note" data-custom-removed-note hidden>该工具已标记删除；点“预演修改”会列出删除项，确认写入后才真正移除。撤销请点右上角“撤销删除”。</p>
  </section>`;
}

function renderSettingsCustomTools(customTools) {
  const container = $('#settings-custom-tools');
  const ids = Object.keys(customTools).sort((left, right) => left.localeCompare(right, 'en'));
  if (ids.length === 0) {
    container.innerHTML =
      '<p class="muted">还没有自定义工具；点页面顶部的“添加自定义工具”填写 id、名称与路径。</p>';
    return;
  }
  container.innerHTML = ids
    .map((id) => customToolCard(id, customTools[id] ?? {}, false))
    .join('');
}

function appendSettingsCustomTool(fields) {
  const container = $('#settings-custom-tools');
  const empty = container.querySelector(':scope > .muted');
  if (empty) empty.remove();

  const wrapper = document.createElement('div');
  wrapper.innerHTML = customToolCard(fields.id, fields, true);
  const card = wrapper.firstElementChild;
  container.append(card);
  card.querySelector('[data-custom-field="name"]').focus();
  card.scrollIntoView({ block: 'nearest' });
  markSettingsDirty();
  invalidateSettingsApply();
}

function openCustomToolDialog() {
  if (!settingsState?.available || !settingsState.writable) {
    showError(new Error('机器档案不可用或不可写，无法添加自定义工具'));
    return;
  }
  $('#custom-tool-form').reset();
  showCustomToolError('');
  const dialog = $('#custom-tool-dialog');
  if (!dialog.open) dialog.showModal();
  $('#custom-tool-form [data-custom-field="id"]').focus();
}

function showCustomToolError(message) {
  const box = $('#custom-tool-error');
  box.textContent = message;
  box.hidden = message === '';
}

function validateNewCustomTool(fields) {
  if (!fields.id) throw new Error('自定义工具 id 不能为空');
  if (!CUSTOM_TOOL_ID.test(fields.id)) {
    throw new Error(
      `自定义工具 id 不合法：${fields.id}。只能使用小写字母、数字和短横线，且以字母或数字开头，最长 40 个字符。`
    );
  }
  for (const [field, label] of [
    ['name', '显示名称'],
    ['configRoot', '配置目录'],
    ['entryPath', '入口文件']
  ]) {
    if (!fields[field]) throw new Error(`自定义工具 ${fields.id} 缺少${label}`);
  }
  const builtInIds = new Set(
    (settingsState?.tools ?? []).filter((tool) => !tool.custom).map((tool) => tool.id)
  );
  if (builtInIds.has(fields.id)) {
    throw new Error(`自定义工具 id 与内置工具重复：${fields.id}；请换一个 id。`);
  }
  if (Object.hasOwn(settingsState?.customTools ?? {}, fields.id)) {
    throw new Error(`自定义工具 id 已存在：${fields.id}；请换一个 id。`);
  }
  for (const card of document.querySelectorAll(
    '#settings-custom-tools .settings-custom-tool[data-new="true"]'
  )) {
    const input = card.querySelector('[data-custom-field="id"]');
    if (input?.value.trim() === fields.id) {
      throw new Error(`自定义工具 id 重复：${fields.id}`);
    }
  }
}

function submitCustomTool() {
  try {
    const fields = readCustomToolFields($('#custom-tool-form'));
    validateNewCustomTool(fields);
    showCustomToolError('');
    $('#custom-tool-dialog').close();
    appendSettingsCustomTool(fields);
  } catch (error) {
    showCustomToolError(error.message);
  }
}

function setCustomCardRemoved(card, removed) {
  card.classList.toggle('removed', removed);
  card.querySelectorAll('input, select, textarea').forEach((control) => {
    control.disabled = removed;
  });
  const badge = card.querySelector('[data-custom-state]');
  if (badge) {
    badge.textContent = removed ? '将删除（写入后生效）' : '已保存';
    badge.classList.toggle('bad', removed);
  }
  const button = card.querySelector('[data-custom-remove]');
  if (button) button.textContent = removed ? '撤销删除' : '删除';
  const note = card.querySelector('[data-custom-removed-note]');
  if (note) note.hidden = !removed;
}

function toggleCustomToolRemoval(button) {
  const card = button.closest('.settings-custom-tool');
  if (!card) return;
  if (card.dataset.new === 'true') {
    card.remove();
    const container = $('#settings-custom-tools');
    if (!container.querySelector('.settings-custom-tool')) {
      container.innerHTML =
        '<p class="muted">还没有自定义工具；点页面顶部的“添加自定义工具”填写 id、名称与路径。</p>';
    }
  } else {
    const id = card.dataset.toolId;
    const removed = !customRemoved.has(id);
    if (removed) customRemoved.add(id);
    else customRemoved.delete(id);
    setCustomCardRemoved(card, removed);
  }
  markSettingsDirty();
  invalidateSettingsApply();
}

function readCustomToolFields(root) {
  const value = (field) => root.querySelector(`[data-custom-field="${field}"]`).value;
  const trim = (field) => value(field).trim();
  const frontmatter = value('frontmatter').replace(/\r\n/g, '\n');
  return {
    id: trim('id'),
    name: trim('name'),
    configRoot: trim('configRoot'),
    entryPath: trim('entryPath'),
    strategy: value('strategy'),
    format: value('format'),
    skillsDir: trim('skillsDir'),
    frontmatter: frontmatter.trim() === '' ? '' : frontmatter,
    enabled: value('enabled') !== 'false'
  };
}

function customCardIsBlank(card) {
  for (const field of ['id', 'name', 'configRoot', 'entryPath', 'skillsDir', 'frontmatter']) {
    const control = card.querySelector(`[data-custom-field="${field}"]`);
    if (control && control.value.trim() !== '') return false;
  }
  return true;
}

function collectCustomToolChanges(changes) {
  const originals = settingsState.customTools ?? {};
  const builtInIds = new Set(
    (settingsState.tools ?? []).filter((tool) => !tool.custom).map((tool) => tool.id)
  );
  const seen = new Set();

  for (const card of document.querySelectorAll('#settings-custom-tools .settings-custom-tool')) {
    const isNew = card.dataset.new === 'true';
    const idInput = card.querySelector('[data-custom-field="id"]');
    const id = (isNew ? idInput.value : card.dataset.toolId).trim();
    if (isNew && customCardIsBlank(card)) continue;
    if (!id) throw new Error('自定义工具 id 不能为空');
    if (!CUSTOM_TOOL_ID.test(id)) {
      throw new Error(
        `自定义工具 id 不合法：${id}。只能使用小写字母、数字和短横线，且以字母或数字开头，最长 40 个字符。`
      );
    }
    if (seen.has(id)) throw new Error(`自定义工具 id 重复：${id}`);
    seen.add(id);

    if (!isNew && customRemoved.has(id)) {
      changes[`customTools.${id}`] = null;
      continue;
    }
    if (isNew && builtInIds.has(id)) {
      throw new Error(`自定义工具 id 与内置工具重复：${id}；请换一个 id。`);
    }

    const fields = readCustomToolFields(card);
    if (isNew) {
      if (!fields.name) throw new Error(`自定义工具 ${id} 缺少显示名称`);
      if (!fields.configRoot) throw new Error(`自定义工具 ${id} 缺少配置目录`);
      if (!fields.entryPath) throw new Error(`自定义工具 ${id} 缺少入口文件`);
      changes[`customTools.${id}.name`] = fields.name;
      changes[`customTools.${id}.configRoot`] = fields.configRoot;
      changes[`customTools.${id}.entryPath`] = fields.entryPath;
      changes[`customTools.${id}.strategy`] = fields.strategy;
      changes[`customTools.${id}.format`] = fields.format;
      changes[`customTools.${id}.enabled`] = fields.enabled;
      if (fields.skillsDir) changes[`customTools.${id}.skillsDir`] = fields.skillsDir;
      if (fields.frontmatter) changes[`customTools.${id}.frontmatter`] = fields.frontmatter;
      continue;
    }

    const original = originals[id] ?? {};
    const before = {
      name: typeof original.name === 'string' ? original.name : '',
      configRoot: typeof original.configRoot === 'string' ? original.configRoot : '',
      entryPath: typeof original.entryPath === 'string' ? original.entryPath : '',
      strategy: original.strategy === 'separate-file' ? 'separate-file' : 'block-append',
      format: original.format === 'mdc' ? 'mdc' : 'markdown',
      skillsDir: typeof original.skillsDir === 'string' ? original.skillsDir : '',
      frontmatter: typeof original.frontmatter === 'string' ? original.frontmatter : '',
      enabled: original.enabled !== false
    };

    for (const field of ['name', 'configRoot', 'entryPath']) {
      if (fields[field] !== before[field]) {
        changes[`customTools.${id}.${field}`] = fields[field] || null;
      }
    }
    if (fields.strategy !== before.strategy) {
      changes[`customTools.${id}.strategy`] = fields.strategy;
    }
    if (fields.format !== before.format) {
      changes[`customTools.${id}.format`] = fields.format;
    }
    if (fields.skillsDir !== before.skillsDir) {
      changes[`customTools.${id}.skillsDir`] = fields.skillsDir || null;
    }
    if (fields.frontmatter !== before.frontmatter) {
      changes[`customTools.${id}.frontmatter`] = fields.frontmatter || null;
    }
    if (fields.enabled !== before.enabled) {
      changes[`customTools.${id}.enabled`] = fields.enabled;
    }
  }
}

function collectSettingsChanges() {
  if (!settingsState?.available || !settingsState.writable) {
    throw new Error('机器档案不可用或不可写，无法修改设置');
  }

  const changes = {};
  const retention = Number($('#settings-retention').value);
  if (!Number.isInteger(retention) || retention < 1) {
    throw new Error('备份保留份数必须是大于 0 的整数');
  }
  if (retention !== settingsState.backupRetention.value) {
    changes.backupRetention = retention;
  }

  const port = Number($('#settings-gui-port').value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('GUI 端口必须是 0 到 65535 之间的整数');
  }
  if (port !== settingsState.guiPort.value) {
    changes.guiPort = port;
  }

  const seenEnv = new Set();
  const nextEnv = {};
  for (const row of $('#settings-env-rows').querySelectorAll('.env-row')) {
    const name = row.querySelector('[data-env-name]').value.trim();
    const value = row.querySelector('[data-env-value]').value.trim();
    if (!name) {
      if (value) throw new Error('环境变量名不能为空');
      continue;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`环境变量名不合法：${name}。只能使用字母、数字和下划线，且不能以数字开头。`);
    }
    if (seenEnv.has(name)) throw new Error(`环境变量重复：${name}`);
    if (/[\r\n\0]/.test(value)) throw new Error(`环境变量 ${name} 的值不能包含换行或空字符`);
    seenEnv.add(name);
    if (value === '') continue;
    nextEnv[name] = value;
  }

  for (const name of Object.keys(settingsState.env)) {
    if (!Object.hasOwn(nextEnv, name)) changes[`env.${name}`] = null;
  }
  for (const [name, value] of Object.entries(nextEnv)) {
    if (settingsState.env[name] !== value) changes[`env.${name}`] = value;
  }

  for (const section of document.querySelectorAll('#settings-tools .settings-tool')) {
    const toolId = section.dataset.toolId;
    const overrides = settingsState.overrides[toolId] ?? {};
    const enabledSelect = section.querySelector('[data-setting-field="enabled"]');
    const enabled =
      enabledSelect.value === '' ? null : enabledSelect.value === 'true';
    if (enabled !== (overrides.enabled ?? null)) {
      changes[`tools.${toolId}.enabled`] = enabled;
    }

    for (const field of ['configRoot', 'entryPath', 'skillsDir']) {
      const input = section.querySelector(`[data-setting-field="${field}"]`);
      const value = input.value.trim() === '' ? null : input.value.trim();
      if (value !== (overrides[field] ?? null)) {
        changes[`tools.${toolId}.${field}`] = value;
      }
    }
  }

  collectCustomToolChanges(changes);

  return changes;
}

async function previewSettings() {
  const changes = collectSettingsChanges();
  if (Object.keys(changes).length === 0) {
    $('#settings-plan').innerHTML = '<p class="notice">没有需要修改的设置项。</p>';
    pendingSettings = null;
    $('#settings-apply-box').hidden = true;
    return;
  }

  const result = await api('settings', { positionals: ['set'], changes });
  renderSettingsPlan(result, changes);
}

function renderSettingsPlan(result, previewedChanges) {
  const rows = result.changes.map((change) => [
    `<code>${esc(change.key)}</code>`,
    esc(SETTINGS_CHANGE_LABELS[change.action] ?? change.action),
    esc(formatSettingsValue(change.from)),
    esc(formatSettingsValue(change.to))
  ]);
  const issues = result.issues
    .map((issue) => `<li>${esc(issue.key)}：${esc(issue.message)}</li>`)
    .join('');
  const status =
    result.ok
      ? '<p class="notice ok">预演完成；核对变更后勾选确认写入。</p>'
      : `<p class="notice bad">${esc(result.reason ?? '预演发现问题')}</p>`;

  $('#settings-plan').innerHTML = [
    '<h2>修改预演（不会写入文件）</h2>',
    status,
    table(['设置项', '动作', '原值', '新值'], rows),
    issues ? `<ul class="settings-issues">${issues}</ul>` : ''
  ].join('');

  if (result.ok && result.changed && result.status === 'preview') {
    pendingSettings = { changes: previewedChanges, fileHash: result.fileHash };
    $('#settings-apply-target').textContent = `将写入 ${result.filePath}；写入前备份到 state/settings-backups/，写入后核对哈希与解析结果。`;
    $('#settings-confirm').checked = false;
    $('#settings-apply').disabled = true;
    $('#settings-apply-box').hidden = false;
  } else {
    pendingSettings = null;
    $('#settings-apply-box').hidden = true;
  }
}

async function applySettings() {
  if (!pendingSettings) throw new Error('请先预演并核对设置修改');
  const result = await api(
    'settings',
    {
      positionals: ['set'],
      changes: pendingSettings.changes,
      expectedFileHash: pendingSettings.fileHash,
      apply: true
    },
    true
  );
  pendingSettings = null;
  await loadSettingsPage();
  $('#settings-result').innerHTML = renderSettingsResult(result);
  $('#settings-plan').innerHTML = '';
  if (result.ok) await refreshToolSelects().catch(() => {});
}

function renderSettingsResult(result) {
  const statusLabel = {
    applied: '已写入机器档案',
    unchanged: '没有需要写入的内容',
    blocked: '已阻止，未写入'
  };
  const issues = result.issues
    .map((issue) => `<li>${esc(issue.key)}：${esc(issue.message)}</li>`)
    .join('');
  const label = statusLabel[result.status] ?? result.status;
  const detail =
    result.reason && result.reason !== label ? `：${esc(result.reason)}` : '';
  const lines = [
    `<p class="${result.ok ? 'notice ok' : 'notice bad'}">${esc(label)}${detail}</p>`,
    `<p class="hint">文件：${esc(result.filePath)}；哈希：${esc(result.fileHash)}</p>`
  ];
  if (result.backup) lines.push(`<p class="hint">写入前备份：${esc(result.backup)}</p>`);
  if (issues) lines.push(`<ul class="settings-issues">${issues}</ul>`);
  return lines.join('');
}

function formatSettingsValue(value) {
  if (value === null || value === undefined) return '（未设置）';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function invalidateSettingsApply() {
  pendingSettings = null;
  $('#settings-confirm').checked = false;
  $('#settings-apply').disabled = true;
  $('#settings-apply-box').hidden = true;
}

function syncSettingsActions() {
  $('#settings-preview').disabled = !settingsDirty;
  $('#settings-reset').disabled = !settingsDirty;
}

function setSettingsDirty(dirty) {
  settingsDirty = dirty;
  syncSettingsActions();
}

function markSettingsDirty() {
  if (!settingsDirty) setSettingsDirty(true);
}

function contentItemMatches(item, kind, name) {
  return item.kind === kind && item.name === name;
}

function isContentDirty() {
  return Boolean(contentSelection) && $('#content-editor').value !== contentSaved;
}

function renderContentList() {
  const container = $('#content-list');
  if (!contentState) {
    container.innerHTML = '<p class="muted">尚未加载内容。</p>';
    return;
  }

  const rules = contentState.rules ?? [];
  const skills = contentState.skills ?? [];
  container.innerHTML = [
    '<h3>规则</h3>',
    rules.length > 0
      ? rules.map(contentItemHtml).join('')
      : '<p class="muted">没有可编辑的规则。</p>',
    '<h3>技能</h3>',
    skills.length > 0
      ? skills.map(contentItemHtml).join('')
      : '<p class="muted">没有可编辑的技能。</p>'
  ].join('');
}

function contentItemHtml(item) {
  const active =
    contentSelection && contentItemMatches(contentSelection, item.kind, item.name);
  const marks = [];
  if (item.isIndex) marks.push('<span class="content-mark">索引</span>');
  if (item.builtin) marks.push('<span class="content-mark">内置</span>');
  if (item.indexed === false) marks.push('<span class="content-mark warn">未登记</span>');

  return `<button type="button" class="content-item${active ? ' active' : ''}" data-content-kind="${esc(
    item.kind
  )}" data-content-name="${esc(item.name)}" title="${esc(item.file)}">
    <span class="content-item-name">${esc(item.name)}</span>
    ${
      marks.length > 0
        ? `<span class="content-item-marks">${marks.join('')}</span>`
        : ''
    }
    <span class="content-item-title">${esc(item.title || item.name)}</span>
  </button>`;
}

function paintContentEditor() {
  const editor = $('#content-editor');
  if (!contentSelection) {
    $('#content-editor-title').textContent = '选择左侧文件';
    $('#content-editor-meta').textContent = '加载内容后，点左侧文件开始编辑。';
    editor.value = '';
    editor.disabled = true;
    $('#content-dirty').hidden = true;
    $('#content-validate').disabled = true;
    $('#content-revert').disabled = true;
    $('#content-save-box').hidden = true;
    $('#content-confirm').checked = false;
    $('#content-save').disabled = true;
    return;
  }

  const meta = [contentSelection.file, `哈希 ${hashShort(contentSelection.fileHash)}`];
  if (contentSelection.isIndex) meta.push('规则索引');
  if (contentSelection.builtin) meta.push('内置技能');
  $('#content-editor-title').textContent = `${
    contentSelection.title || contentSelection.name
  }（${contentSelection.name}）`;
  $('#content-editor-meta').textContent = meta.join(' · ');
  editor.disabled = false;

  const dirty = isContentDirty();
  $('#content-dirty').hidden = !dirty;
  $('#content-validate').disabled = !dirty;
  $('#content-revert').disabled = !dirty;
  syncContentSave();
}

function invalidateContentApply() {
  contentValidation = null;
  $('#content-save-box').hidden = true;
  $('#content-confirm').checked = false;
  $('#content-save').disabled = true;
}

function syncContentSave() {
  const valid =
    Boolean(contentValidation) &&
    contentValidation.content === $('#content-editor').value &&
    contentValidation.result.canApply;

  if (!valid) {
    $('#content-save-box').hidden = true;
    $('#content-save').disabled = true;
    return;
  }

  $('#content-save-box').hidden = false;
  $('#content-save-target').textContent = `将写入 ${contentValidation.result.file}；保存后重建构建。`;
  $('#content-save').disabled = !$('#content-confirm').checked;
}

function contentIssueList(issues, label) {
  if (!Array.isArray(issues) || issues.length === 0) return '';
  return `<p class="hint">${esc(label)}（${issues.length}）：</p><ul class="content-issues">${issues
    .map((issue) => `<li>${esc(`${issue.file}：${issue.message}`)}</li>`)
    .join('')}</ul>`;
}

function contentSaveValidationHtml(result) {
  const blocks = [];
  if (result.status === 'preview') {
    blocks.push('<p class="notice ok">校验通过。确认后会写入文件并重建构建。</p>');
  } else if (result.status === 'unchanged') {
    blocks.push('<p class="notice">内容与当前文件一致，没有需要保存的修改。</p>');
  } else {
    blocks.push(`<p class="notice bad">${esc(result.reason)}</p>`);
  }
  blocks.push(contentIssueList(result.lint?.errors, '错误'));
  blocks.push(contentIssueList(result.lint?.warnings, '提醒'));
  return blocks.filter(Boolean).join('');
}

async function loadContentPage() {
  clearError();
  const result = await api('content', { positionals: ['list'] });
  contentState = result;
  renderContentList();
  $('#content-status').innerHTML = `<p class="notice ok">已加载 ${result.rules.length} 条规则、${result.skills.length} 个技能。</p>`;

  if (contentSelection) {
    const exists = [...result.rules, ...result.skills].some((item) =>
      contentItemMatches(item, contentSelection.kind, contentSelection.name)
    );
    if (exists) {
      await selectContentFile(contentSelection.kind, contentSelection.name);
      return;
    }
  }

  contentSelection = null;
  contentSaved = '';
  contentValidation = null;
  $('#content-editor-result').innerHTML = '';
  paintContentEditor();
  renderContentList();
}

async function selectContentFile(kind, name) {
  const token = ++contentReadToken;
  const result = await api('content', { positionals: ['read', kind, name] });
  if (token !== contentReadToken) return;

  contentSelection = result;
  contentSaved = result.content;
  contentValidation = null;
  $('#content-editor').value = result.content;
  $('#content-confirm').checked = false;
  $('#content-save-box').hidden = true;
  $('#content-save').disabled = true;
  $('#content-editor-result').innerHTML = '';
  paintContentEditor();
  renderContentList();
}

async function handleContentList(event) {
  const button = event.target.closest('[data-content-kind]');
  if (!button) return;

  const kind = button.dataset.contentKind;
  const name = button.dataset.contentName;
  if (
    contentSelection &&
    contentItemMatches(contentSelection, kind, name) &&
    !isContentDirty()
  ) {
    return;
  }
  if (
    isContentDirty() &&
    !window.confirm('当前修改尚未保存，切换文件会丢失修改。确定继续吗？')
  ) {
    return;
  }
  await selectContentFile(kind, name);
}

async function refreshContentPage() {
  if (
    isContentDirty() &&
    !window.confirm('当前修改尚未保存，重新加载会丢失修改。确定继续吗？')
  ) {
    return;
  }
  await loadContentPage();
}

async function validateContentSave() {
  if (!contentSelection) throw new Error('请先选择要编辑的规则或技能');
  const content = $('#content-editor').value;
  const result = await api('content', {
    positionals: ['save', contentSelection.kind, contentSelection.name],
    content,
    expectedFileHash: contentSelection.fileHash
  });
  if (content !== $('#content-editor').value) return;

  contentValidation = {
    content,
    fileHash: contentSelection.fileHash,
    result
  };
  $('#content-editor-result').innerHTML = contentSaveValidationHtml(result);
  syncContentSave();
}

async function applyContentSave() {
  if (!contentValidation) throw new Error('请先校验并预演保存');
  const content = $('#content-editor').value;
  if (content !== contentValidation.content) {
    throw new Error('内容在预演后已修改，请重新校验');
  }

  const { kind, name } = contentSelection;
  const result = await api(
    'content',
    {
      positionals: ['save', kind, name],
      content,
      expectedFileHash: contentValidation.fileHash,
      apply: true
    },
    true
  );
  if (result.status !== 'applied') throw new Error(result.reason || '内容未写入');
  invalidateContentApply();
  await refreshContentAfterWrite(kind, name, renderContentSaveApplied(result));
}

function renderContentSaveApplied(result) {
  const blocks = [
    `<p class="notice ok">已保存 ${esc(result.file)}${result.build ? '并重建构建' : ''}。</p>`
  ];
  if (result.build) {
    blocks.push(
      `<p class="hint">构建内容哈希：${esc(hashShort(result.build.contentHash))}；入口：${esc(
        result.build.entry
      )}。</p>`
    );
  }
  blocks.push(contentIssueList(result.lint?.warnings, '提醒'));
  return blocks.filter(Boolean).join('');
}

async function refreshContentAfterWrite(kind, name, message) {
  const list = await api('content', { positionals: ['list'] });
  contentState = list;
  renderContentList();
  await selectContentFile(kind, name);
  $('#content-editor-result').innerHTML = message;
  $('#content-status').innerHTML = '<p class="notice ok">内容列表已刷新。</p>';
  paintContentEditor();
}

async function runContentLint() {
  const result = await api('content', { positionals: ['lint'] });
  $('#content-status').innerHTML = renderContentLint(result);
}

function renderContentLint(result) {
  const blocks = [
    `<p class="notice ${result.ok ? 'ok' : 'bad'}">内容校验${
      result.ok ? '通过' : '未通过'
    }：规则 ${result.rules.length} 条，技能 ${result.skills.length} 个，错误 ${
      result.errors.length
    } 个，提醒 ${result.warnings.length} 个。</p>`
  ];
  blocks.push(contentIssueList(result.errors, '错误'));
  blocks.push(contentIssueList(result.warnings, '提醒'));
  return blocks.filter(Boolean).join('');
}

function openContentNewDialog(kind) {
  contentNewKind = kind;
  const isRule = kind === 'rule';
  $('#content-new-form').reset();
  $('#content-new-dialog-title').textContent = isRule ? '新建规则' : '新建技能';
  $('#content-new-name').placeholder = isRule
    ? '例如 storage-tips（不用写编号）'
    : '例如 release-check';
  $('#content-new-description-row').hidden = isRule;
  $('#content-new-hint').textContent = isRule
    ? '规则会自动分配下一个两位编号，并登记到 content/rules/00-index.md 的阅读顺序与文件职责表。'
    : '技能会创建 content/skills/<名称>/SKILL.md；名称即技能标识，创建后不能改名，部署时会按此目录创建 junction。';
  $('#content-new-error').hidden = true;
  $('#content-new-error').textContent = '';
  resetContentNewPreview();
  $('#content-new-dialog').showModal();
}

function resetContentNewPreview() {
  pendingContentCreate = null;
  $('#content-new-preview').innerHTML = '';
  $('#content-new-confirm-row').hidden = true;
  $('#content-new-confirm').checked = false;
  $('#content-new-create').disabled = true;
}

function syncContentNewCreate() {
  $('#content-new-create').disabled = !(
    pendingContentCreate && $('#content-new-confirm').checked
  );
}

function showContentNewError(error) {
  const box = $('#content-new-error');
  box.textContent = error instanceof Error ? error.message : String(error);
  box.hidden = false;
}

async function previewContentCreate() {
  const name = $('#content-new-name').value.trim();
  if (!name) {
    showContentNewError('请填写名称');
    return;
  }

  const isRule = contentNewKind === 'rule';
  const title = $('#content-new-title').value.trim();
  const description = isRule ? '' : $('#content-new-description').value.trim();
  const result = await api('content', {
    positionals: [isRule ? 'new-rule' : 'new-skill', name],
    title: title || undefined,
    description: isRule ? undefined : description,
    dryRun: true
  });
  if (
    name !== $('#content-new-name').value.trim() ||
    title !== $('#content-new-title').value.trim() ||
    description !== (isRule ? '' : $('#content-new-description').value.trim())
  ) {
    return;
  }

  pendingContentCreate = { kind: contentNewKind, name, title, description };
  const lines = [
    `<p class="notice ok">预演通过：将创建 ${esc(result.file)}${
      isRule ? '，并登记规则索引' : ''
    }。</p>`
  ];
  if (isRule) {
    lines.push(
      `<p class="hint">索引：${
        result.readingOrderUpdated ? '将登记阅读顺序' : '未找到阅读顺序'
      }；${result.dutyTableUpdated ? '将补文件职责表' : '未找到文件职责表'}。</p>`
    );
  }
  lines.push(
    `<details class="hint-box"><summary>查看将写入的模板</summary><pre class="content-preview">${esc(
      result.content
    )}</pre></details>`
  );
  $('#content-new-preview').innerHTML = lines.join('');
  $('#content-new-error').hidden = true;
  $('#content-new-confirm-row').hidden = false;
  $('#content-new-confirm').checked = false;
  syncContentNewCreate();
}

async function createContentFromDialog() {
  if (!pendingContentCreate) throw new Error('请先预演新建');

  const { kind, name, title, description } = pendingContentCreate;
  const isRule = kind === 'rule';
  const result = await api(
    'content',
    {
      positionals: [isRule ? 'new-rule' : 'new-skill', name],
      title,
      description: isRule ? undefined : description,
      build: true
    },
    true
  );
  const createdName = isRule
    ? result.file.split('/').pop().replace(/\.md$/, '')
    : result.name || name;
  $('#content-new-dialog').close();
  await refreshContentAfterCreate(kind, createdName, result);
}

async function refreshContentAfterCreate(kind, name, result) {
  const list = await api('content', { positionals: ['list'] });
  contentState = list;
  renderContentList();
  await selectContentFile(kind, name);
  const blocks = [
    `<p class="notice ok">已创建 ${esc(result.file)}${
      result.build ? '并重建构建' : ''
    }。</p>`
  ];
  if (result.build) {
    blocks.push(
      `<p class="hint">构建内容哈希：${esc(hashShort(result.build.contentHash))}；入口：${esc(
        result.build.entry
      )}。</p>`
    );
  }
  $('#content-editor-result').innerHTML = blocks.join('');
  $('#content-status').innerHTML =
    '<p class="notice ok">内容列表已刷新；新文件已打开，可继续编辑。</p>';
  paintContentEditor();
}

async function submitContentCreate(button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '处理中…';
  try {
    await createContentFromDialog();
  } catch (error) {
    showContentNewError(error);
  } finally {
    button.textContent = label;
    syncContentNewCreate();
  }
}

function handleContentNewFieldChange() {
  resetContentNewPreview();
  $('#content-new-error').hidden = true;
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
      if (tab.dataset.page === 'history') {
        loadHistory().catch(showError);
      }
      if (tab.dataset.page === 'diagnose') {
        loadDiagnosePage().catch(showError);
      } else {
        $('#diagnose-confirm-box').hidden = true;
        $('#diagnose-confirm').checked = false;
        $('#diagnose-generate').disabled = true;
      }
      if (tab.dataset.page === 'projects') {
        $('#project-apply-box').hidden = true;
        pendingProject = null;
        scanProjectList().catch(showError);
      }
      if (tab.dataset.page === 'merge') {
        refreshToolSelects().catch(showError);
      } else {
        invalidateMergeApply();
      }
      if (tab.dataset.page === 'deploy') {
        refreshToolSelects().catch(showError);
      }
      if (tab.dataset.page === 'settings') {
        loadSettingsPage().catch(showError);
      } else {
        invalidateSettingsApply();
      }
      if (tab.dataset.page === 'content') {
        if (!contentState) loadContentPage().catch(showError);
      } else {
        invalidateContentApply();
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

  $('#history-refresh').addEventListener('click', (event) => {
    withBusy(event.currentTarget, loadHistory).catch(showError);
  });
  $('#history-limit').addEventListener('change', () => {
    loadHistory().catch(showError);
  });

  $('#diagnose-refresh').addEventListener('click', (event) => {
    withBusy(event.currentTarget, loadDiagnosePage).catch(showError);
  });
  $('#diagnose-confirm').addEventListener('change', (event) => {
    $('#diagnose-generate').disabled = !event.currentTarget.checked;
  });
  $('#diagnose-generate').addEventListener('click', (event) => {
    withBusy(event.currentTarget, generateDiagnose)
      .catch(showError)
      .finally(() => {
        $('#diagnose-generate').disabled = !$('#diagnose-confirm').checked;
      });
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
      if (selector === '#project-mode') updateProjectModeHint();
    });
  }
  $('#project-confirm').addEventListener('change', (event) => {
    $('#project-apply').disabled = !event.currentTarget.checked;
  });
  $('#project-apply').addEventListener('click', (event) => {
    withBusy(event.currentTarget, applyProject).catch(showError);
  });

  $('#merge-load').addEventListener('click', (event) => {
    withBusy(event.currentTarget, loadMergePreview).catch(showError);
  });
  $('#merge-reset').addEventListener('click', resetMergeResult);
  $('#merge-validate').addEventListener('click', (event) => {
    withBusy(event.currentTarget, validateMerge).catch(showError);
  });
  $('#merge-apply').addEventListener('click', (event) => {
    withBusy(event.currentTarget, applyMerge).catch(showError);
  });
  $('#merge-confirm').addEventListener('change', (event) => {
    $('#merge-apply').disabled = !event.currentTarget.checked;
  });
  $('#merge-result').addEventListener('input', handleMergeEdit);
  $('#merge-tool').addEventListener('change', resetMergePage);

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

  $('#settings-refresh').addEventListener('click', (event) => {
    withBusy(event.currentTarget, loadSettingsPage).catch(showError);
  });
  $('#settings-reset').addEventListener('click', (event) => {
    withBusy(event.currentTarget, loadSettingsPage)
      .catch(showError)
      .finally(syncSettingsActions);
  });
  $('#settings-preview').addEventListener('click', (event) => {
    withBusy(event.currentTarget, previewSettings)
      .catch(showError)
      .finally(syncSettingsActions);
  });
  $('#settings-apply').addEventListener('click', (event) => {
    withBusy(event.currentTarget, applySettings).catch(showError);
  });
  $('#settings-confirm').addEventListener('change', (event) => {
    $('#settings-apply').disabled = !event.currentTarget.checked;
  });
  $('#settings-env-add').addEventListener('click', () => {
    appendSettingsEnvRow();
    markSettingsDirty();
    invalidateSettingsApply();
  });
  $('#settings-env-rows').addEventListener('click', (event) => {
    const button = event.target.closest('[data-env-remove]');
    if (!button) return;
    button.closest('.env-row').remove();
    markSettingsDirty();
    invalidateSettingsApply();
  });
  $('#settings-custom-add').addEventListener('click', openCustomToolDialog);
  $('#custom-tool-form').addEventListener('submit', (event) => {
    event.preventDefault();
    submitCustomTool();
  });
  for (const selector of ['#custom-tool-close', '#custom-tool-cancel']) {
    $(selector).addEventListener('click', () => {
      $('#custom-tool-dialog').close();
    });
  }
  $('#custom-tool-dialog').addEventListener('click', (event) => {
    if (event.target === $('#custom-tool-dialog')) $('#custom-tool-dialog').close();
  });
  $('#custom-tool-dialog').addEventListener('close', () => {
    showCustomToolError('');
  });
  $('#settings-custom-tools').addEventListener('click', (event) => {
    const button = event.target.closest('[data-custom-remove]');
    if (!button) return;
    toggleCustomToolRemoval(button);
  });
  const handleSettingsEdit = (event) => {
    if (event.target.closest('#settings-apply-box')) return;
    markSettingsDirty();
    invalidateSettingsApply();
  };
  $('#page-settings').addEventListener('input', handleSettingsEdit);
  $('#page-settings').addEventListener('change', handleSettingsEdit);

  $('#content-refresh').addEventListener('click', (event) => {
    withBusy(event.currentTarget, refreshContentPage).catch(showError);
  });
  $('#content-lint').addEventListener('click', (event) => {
    withBusy(event.currentTarget, runContentLint).catch(showError);
  });
  $('#content-new-rule').addEventListener('click', () => openContentNewDialog('rule'));
  $('#content-new-skill').addEventListener('click', () => openContentNewDialog('skill'));
  $('#content-list').addEventListener('click', (event) => {
    handleContentList(event).catch(showError);
  });
  $('#content-editor').addEventListener('input', () => {
    invalidateContentApply();
    $('#content-editor-result').innerHTML = '';
    paintContentEditor();
  });
  $('#content-revert').addEventListener('click', () => {
    if (!contentSelection) return;
    $('#content-editor').value = contentSaved;
    invalidateContentApply();
    $('#content-editor-result').innerHTML = '';
    paintContentEditor();
  });
  $('#content-validate').addEventListener('click', (event) => {
    withBusy(event.currentTarget, validateContentSave)
      .catch(showError)
      .finally(paintContentEditor);
  });
  $('#content-confirm').addEventListener('change', syncContentSave);
  $('#content-save').addEventListener('click', (event) => {
    withBusy(event.currentTarget, applyContentSave)
      .catch((error) => {
        showError(error);
        invalidateContentApply();
      })
      .finally(syncContentSave);
  });

  for (const selector of ['#content-new-close', '#content-new-cancel']) {
    $(selector).addEventListener('click', () => {
      $('#content-new-dialog').close();
    });
  }
  $('#content-new-dialog').addEventListener('click', (event) => {
    if (event.target === $('#content-new-dialog')) $('#content-new-dialog').close();
  });
  $('#content-new-dialog').addEventListener('close', () => {
    pendingContentCreate = null;
    resetContentNewPreview();
    $('#content-new-error').hidden = true;
  });
  $('#content-new-preview-button').addEventListener('click', (event) => {
    withBusy(event.currentTarget, previewContentCreate).catch((error) => {
      resetContentNewPreview();
      showContentNewError(error);
    });
  });
  $('#content-new-confirm').addEventListener('change', syncContentNewCreate);
  $('#content-new-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if ($('#content-new-create').disabled) return;
    submitContentCreate($('#content-new-create'));
  });
  for (const selector of [
    '#content-new-name',
    '#content-new-title',
    '#content-new-description'
  ]) {
    $(selector).addEventListener('input', handleContentNewFieldChange);
  }
}

async function init() {
  $('#cli-hint').textContent =
    'CLI 等价命令：aiwb deploy / aiwb merge <工具 id> / aiwb uninstall / aiwb scan / aiwb attach <项目路径> / aiwb detach <项目路径> / aiwb content lint / aiwb content list / aiwb content read <类型> <名称> / aiwb content save <类型> <名称> --content-file <路径> --apply / aiwb content new-rule <slug> --build / aiwb content new-skill <名称> --description "触发场景" --build / aiwb settings show / aiwb settings set <设置项=值> --apply / aiwb backup list / aiwb backup create / aiwb backup prune / aiwb backup restore / aiwb log / aiwb diagnose --zip';
  if (!token) {
    setConn(false, '缺少令牌');
    showError('地址缺少访问令牌，请使用 aiwb gui 输出的完整地址打开。');
    return;
  }

  bindEvents();
  resetMergePage();
  try {
    await loadOverview();
  } catch (error) {
    setConn(false, '连接失败');
    showError(error);
  }
}

init();

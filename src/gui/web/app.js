const token = new URLSearchParams(location.search).get('token') ?? '';
const $ = (selector) => document.querySelector(selector);

let lastDeployTool = '';
let pendingRestore = null;

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
  pendingRestore = null;
}

async function previewRestore(tool, stamp) {
  clearError();
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
      document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
      document.querySelectorAll('.page').forEach((page) => {
        page.hidden = page.id !== `page-${tab.dataset.page}`;
      });
      tab.classList.add('active');
      if (tab.dataset.page === 'backup') {
        loadBackups().catch(showError);
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

  $('#backup-refresh').addEventListener('click', (event) => {
    withBusy(event.currentTarget, loadBackups).catch(showError);
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
  $('#cli-hint').textContent = 'CLI 等价命令：aiwb deploy / aiwb backup list / aiwb backup restore';
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

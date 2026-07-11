'use strict';

const api = window.quotaHalo;

const state = {
  settings: null,
  snapshot: null,
  selectedSessionId: null,
  refreshTimer: null,
  clockTimer: null,
  toastTimer: null,
  opacityTimer: null,
  refreshing: false,
};

const $ = (id) => document.getElementById(id);

const elements = {
  app: $('app'),
  dashboard: $('dashboard'),
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  sessionTitle: $('sessionTitle'),
  sessionMeta: $('sessionMeta'),
  refreshButton: $('refreshButton'),
  contextRing: $('contextRing'),
  contextPercent: $('contextPercent'),
  contextUsed: $('contextUsed'),
  contextMax: $('contextMax'),
  contextRemaining: $('contextRemaining'),
  contextTrack: $('contextTrack'),
  lastTurn: $('lastTurn'),
  miniPrimary: $('miniPrimary'),
  miniSecondary: $('miniSecondary'),
  planBadge: $('planBadge'),
  primaryWindow: $('primaryWindow'),
  primaryPercent: $('primaryPercent'),
  primaryTrack: $('primaryTrack'),
  primaryRemaining: $('primaryRemaining'),
  primaryReset: $('primaryReset'),
  secondaryWindow: $('secondaryWindow'),
  secondaryPercent: $('secondaryPercent'),
  secondaryTrack: $('secondaryTrack'),
  secondaryRemaining: $('secondaryRemaining'),
  secondaryReset: $('secondaryReset'),
  inputTokens: $('inputTokens'),
  outputTokens: $('outputTokens'),
  cachedTokens: $('cachedTokens'),
  reasoningTokens: $('reasoningTokens'),
  sessionTotal: $('sessionTotal'),
  chartLine: $('chartLine'),
  chartArea: $('chartArea'),
  chartPoint: $('chartPoint'),
  chartStatus: $('chartStatus'),
  sessionList: $('sessionList'),
  activeSessionCount: $('activeSessionCount'),
  lastUpdated: $('lastUpdated'),
  discoveredCount: $('discoveredCount'),
  emptyState: $('emptyState'),
  emptyTitle: $('emptyTitle'),
  emptyMessage: $('emptyMessage'),
  pinButton: $('pinButton'),
  compactButton: $('compactButton'),
  settingsPanel: $('settingsPanel'),
  sourcePath: $('sourcePath'),
  appVersion: $('appVersion'),
  toast: $('toast'),
};

async function init() {
  bindEvents();
  state.settings = await api.getSettings();
  applySettings(state.settings);
  await refresh({ force: true });
  startRefreshTimer();
  state.clockTimer = window.setInterval(updateTimeLabels, 1000);

  api.onRefresh(() => refresh({ force: true }));
  api.onSettingsChanged((settings) => {
    state.settings = settings;
    applySettings(settings);
    startRefreshTimer();
  });
}

function bindEvents() {
  $('minimizeButton').addEventListener('click', () => api.windowAction('minimize'));
  $('closeButton').addEventListener('click', () => api.windowAction('close'));
  $('pinButton').addEventListener('click', () => api.windowAction('toggle-pin'));
  $('compactButton').addEventListener('click', () => api.windowAction('cycle-display'));
  $('settingsButton').addEventListener('click', openSettings);
  $('settingsClose').addEventListener('click', closeSettings);
  elements.refreshButton.addEventListener('click', () => refresh({ force: true, notify: true }));
  $('emptyRefresh').addEventListener('click', () => refresh({ force: true, notify: true }));
  $('emptySettings').addEventListener('click', openSettings);

  bindToggle('alwaysOnTopSetting', 'alwaysOnTop');
  bindToggle('traySetting', 'minimizeToTray');
  bindToggle('miniContextSetting', 'miniContext');
  bindToggle('launchSetting', 'launchAtLogin');

  $('displayModeControl').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-display-mode]');
    if (!button) return;
    await saveSetting({ displayMode: button.dataset.displayMode });
    if (button.dataset.displayMode === 'mini') closeSettings();
  });

  $('themeControl').addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-value]');
    if (button) saveSetting({ theme: button.dataset.themeValue });
  });

  $('accentControl').addEventListener('click', (event) => {
    const button = event.target.closest('[data-accent-value]');
    if (button) saveSetting({ accent: button.dataset.accentValue });
  });

  $('refreshSetting').addEventListener('change', (event) => {
    saveSetting({ refreshMs: Number(event.target.value) });
  });

  $('miniLimitsSetting').addEventListener('change', (event) => {
    saveSetting({ miniLimits: event.target.value });
  });

  $('miniLayoutSetting').addEventListener('change', (event) => {
    saveSetting({ miniLayout: event.target.value });
  });

  $('opacitySetting').addEventListener('input', (event) => {
    $('opacityValue').textContent = `${event.target.value}%`;
    clearTimeout(state.opacityTimer);
    state.opacityTimer = window.setTimeout(() => saveSetting({ opacity: Number(event.target.value) / 100 }, false), 80);
  });

  $('changeSourceButton').addEventListener('click', chooseSource);
  $('openSourceButton').addEventListener('click', () => api.openSource());
  $('resetButton').addEventListener('click', resetSettings);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.settingsPanel.classList.contains('open')) closeSettings();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      refresh({ force: true, notify: true });
    }
  });
}

function bindToggle(id, key) {
  $(id).addEventListener('change', (event) => saveSetting({ [key]: event.target.checked }));
}

async function saveSetting(patch, notify = true) {
  state.settings = await api.updateSettings(patch);
  applySettings(state.settings);
  startRefreshTimer();
  if (notify) showToast('Settings saved');
  if (Object.hasOwn(patch, 'sourceDir')) await refresh({ force: true });
}

function applySettings(settings) {
  elements.app.dataset.theme = settings.theme;
  elements.app.dataset.accent = settings.accent;
  elements.app.dataset.miniLimits = settings.miniLimits;
  elements.app.dataset.miniLayout = settings.miniContext ? settings.miniLayout : 'equal';
  elements.app.dataset.miniContext = String(settings.miniContext);
  document.body.classList.toggle('compact', settings.displayMode === 'compact');
  document.body.classList.toggle('mini', settings.displayMode === 'mini');
  elements.pinButton.classList.toggle('active', settings.alwaysOnTop);
  elements.compactButton.classList.toggle('active', settings.displayMode !== 'full');
  elements.pinButton.setAttribute('aria-pressed', String(settings.alwaysOnTop));
  elements.compactButton.setAttribute('aria-pressed', String(settings.displayMode !== 'full'));
  elements.compactButton.dataset.tip = `Size: ${capitalize(settings.displayMode)}`;

  $('alwaysOnTopSetting').checked = settings.alwaysOnTop;
  $('traySetting').checked = settings.minimizeToTray;
  $('launchSetting').checked = settings.launchAtLogin;
  $('refreshSetting').value = String(settings.refreshMs);
  $('miniLimitsSetting').value = settings.miniLimits;
  $('miniLayoutSetting').value = settings.miniLayout;
  $('miniContextSetting').checked = settings.miniContext;
  $('opacitySetting').value = String(Math.round(settings.opacity * 100));
  $('opacityValue').textContent = `${Math.round(settings.opacity * 100)}%`;
  elements.sourcePath.textContent = settings.sourceDir;
  elements.sourcePath.title = settings.sourceDir;
  elements.appVersion.textContent = `v${settings.appVersion}`;

  document.querySelectorAll('[data-theme-value]').forEach((button) => {
    button.classList.toggle('active', button.dataset.themeValue === settings.theme);
  });
  document.querySelectorAll('[data-accent-value]').forEach((button) => {
    const active = button.dataset.accentValue === settings.accent;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  document.querySelectorAll('[data-display-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.displayMode === settings.displayMode);
  });
}

function startRefreshTimer() {
  clearInterval(state.refreshTimer);
  if (!state.settings) return;
  state.refreshTimer = window.setInterval(() => refresh(), state.settings.refreshMs);
}

async function refresh(options = {}) {
  if (state.refreshing) return;
  state.refreshing = true;
  elements.refreshButton.classList.add('loading');

  try {
    const snapshot = await api.getSnapshot({
      sessionId: state.selectedSessionId,
      force: Boolean(options.force),
    });
    state.snapshot = snapshot;
    renderSnapshot(snapshot);
    if (options.notify) showToast(snapshot.status === 'error' ? 'Refresh failed' : 'Usage refreshed');
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
  } finally {
    state.refreshing = false;
    elements.refreshButton.classList.remove('loading');
  }
}

function renderSnapshot(snapshot) {
  const current = snapshot.current;
  const hasData = Boolean(current?.hasTokenData);

  elements.emptyState.hidden = hasData;
  elements.dashboard.hidden = !hasData;

  if (!hasData) {
    const isError = snapshot.status === 'error';
    elements.emptyTitle.textContent = isError ? 'Unable to read Codex data' : 'No token data yet';
    elements.emptyMessage.textContent = isError
      ? snapshot.error || 'Check the sessions folder in settings and try again.'
      : 'Start or continue a Codex task and QuotaHalo will pick it up automatically.';
    return;
  }

  elements.statusDot.className = `status-dot ${snapshot.status === 'live' ? '' : snapshot.status}`.trim();
  elements.statusText.textContent = snapshot.status === 'live' ? 'Live Codex session' : 'Session data found';
  elements.sessionTitle.textContent = current.title;
  elements.sessionTitle.title = current.title;
  document.title = `${current.title} — QuotaHalo`;

  const workspace = folderName(current.cwd);
  const origin = current.originator || 'Codex';
  elements.sessionMeta.textContent = [origin, workspace, `updated ${relativeTime(current.updatedAt)}`].filter(Boolean).join('  ·  ');
  elements.sessionMeta.title = current.cwd || origin;

  const contextUsed = current.last.totalTokens;
  const contextMax = current.contextWindow;
  const contextPercent = contextMax ? clamp((contextUsed / contextMax) * 100, 0, 100) : 0;
  const contextLeft = Math.max(0, contextMax - contextUsed);
  elements.contextRing.style.setProperty('--progress', contextPercent.toFixed(2));
  elements.contextPercent.textContent = `${Math.round(contextPercent)}%`;
  elements.contextUsed.textContent = formatNumber(contextUsed);
  elements.contextUsed.title = exactNumber(contextUsed);
  elements.contextMax.textContent = `/ ${formatNumber(contextMax)}`;
  elements.contextRemaining.textContent = contextMax
    ? `${formatNumber(contextLeft)} tokens of headroom`
    : 'Context window unavailable';
  elements.contextTrack.style.width = `${contextPercent}%`;
  elements.lastTurn.textContent = formatNumber(current.last.totalTokens);
  elements.lastTurn.title = exactNumber(current.last.totalTokens);

  const limits = current.rateLimits;
  elements.planBadge.textContent = formatPlan(limits?.planType);
  const primaryLeft = quotaLeft(limits?.primary);
  const secondaryLeft = quotaLeft(limits?.secondary);
  elements.miniPrimary.textContent = primaryLeft === null ? '—' : formatPercent(primaryLeft);
  elements.miniSecondary.textContent = secondaryLeft === null ? '—' : formatPercent(secondaryLeft);
  elements.miniPrimary.parentElement.style.setProperty('--progress', (primaryLeft || 0).toFixed(2));
  elements.miniSecondary.parentElement.style.setProperty('--progress', (secondaryLeft || 0).toFixed(2));
  renderLimit('primary', limits?.primary);
  renderLimit('secondary', limits?.secondary);

  setMetric(elements.inputTokens, current.total.inputTokens);
  setMetric(elements.outputTokens, current.total.outputTokens);
  setMetric(elements.cachedTokens, current.total.cachedInputTokens);
  setMetric(elements.reasoningTokens, current.total.reasoningOutputTokens);
  setMetric(elements.sessionTotal, current.total.totalTokens);

  renderChart(current.activity, contextMax);
  renderSessions(snapshot.sessions, current.id);
  elements.activeSessionCount.textContent = `${snapshot.summary.activeSessions} active`;
  elements.discoveredCount.textContent = `${snapshot.summary.discoveredSessions} session${snapshot.summary.discoveredSessions === 1 ? '' : 's'} found`;
  updateTimeLabels();
}

function renderLimit(prefix, limit) {
  const label = elements[`${prefix}Window`];
  const percent = elements[`${prefix}Percent`];
  const track = elements[`${prefix}Track`];
  const remaining = elements[`${prefix}Remaining`];
  const reset = elements[`${prefix}Reset`];

  if (!limit) {
    label.textContent = prefix === 'primary' ? 'Primary limit' : 'Secondary limit';
    percent.textContent = '—';
    track.style.width = '0%';
    remaining.textContent = 'Usage unavailable';
    reset.textContent = 'Reset time unavailable';
    reset.dataset.resetAt = '';
    return;
  }

  const used = clamp(limit.usedPercent, 0, 100);
  const left = 100 - used;
  label.textContent = formatWindow(limit.windowMinutes, prefix);
  percent.textContent = `${formatPercent(left)} left`;
  track.style.width = `${left}%`;
  track.classList.toggle('warning', left <= 20);
  remaining.textContent = `${formatPercent(left)} remaining`;
  reset.dataset.resetAt = String(limit.resetsAt || '');
  reset.textContent = resetText(limit.resetsAt);
}

function quotaLeft(limit) {
  return limit && Number.isFinite(limit.usedPercent)
    ? 100 - clamp(limit.usedPercent, 0, 100)
    : null;
}

function renderChart(activity, contextMax) {
  const values = (activity || []).map((point) => point.contextTokens).filter(Number.isFinite);
  if (!values.length) {
    elements.chartLine.setAttribute('d', 'M0 76H420');
    elements.chartArea.setAttribute('d', 'M0 76H420V82H0Z');
    elements.chartPoint.setAttribute('cx', '420');
    elements.chartPoint.setAttribute('cy', '76');
    elements.chartStatus.textContent = 'Waiting for activity';
    return;
  }

  if (values.length === 1) values.unshift(values[0]);
  const width = 420;
  const top = 7;
  const bottom = 76;
  const scaleMax = Math.max(contextMax || 0, ...values, 1);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = bottom - (clamp(value / scaleMax, 0, 1) * (bottom - top));
    return [x, y];
  });
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = points.at(-1);
  elements.chartLine.setAttribute('d', line);
  elements.chartArea.setAttribute('d', `${line} L${width} 82 L0 82 Z`);
  elements.chartPoint.setAttribute('cx', last[0].toFixed(1));
  elements.chartPoint.setAttribute('cy', last[1].toFixed(1));
  elements.chartStatus.textContent = `${values.length} recent samples`;
}

function renderSessions(sessions, currentId) {
  elements.sessionList.replaceChildren();

  for (const session of sessions.slice(0, 5)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'session-item';
    if (session.id === currentId) button.classList.add('selected');
    if (Date.now() - new Date(session.fileUpdatedAt).getTime() < 30 * 60 * 1000) button.classList.add('recent');
    button.setAttribute('aria-pressed', String(session.id === currentId));

    const signal = document.createElement('i');
    signal.className = 'session-signal';
    const copy = document.createElement('span');
    copy.className = 'session-item-copy';
    const title = document.createElement('strong');
    title.textContent = session.title;
    const meta = document.createElement('span');
    meta.textContent = `${folderName(session.cwd) || session.originator} · ${formatNumber(session.total.totalTokens)} tokens`;
    copy.append(title, meta);
    const time = document.createElement('span');
    time.className = 'session-item-time';
    time.textContent = relativeTime(session.updatedAt);
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-chevron');
    chevron.append(use);
    button.append(signal, copy, time, chevron);
    button.addEventListener('click', () => selectSession(session.id));
    elements.sessionList.append(button);
  }
}

async function selectSession(id) {
  if (id === state.selectedSessionId || id === state.snapshot?.current?.id) return;
  state.selectedSessionId = id;
  await refresh({ force: true });
}

function updateTimeLabels() {
  if (!state.snapshot) return;
  elements.lastUpdated.textContent = `Synced ${relativeTime(state.snapshot.scannedAt)}`;
  document.querySelectorAll('[data-reset-at]').forEach((element) => {
    element.textContent = resetText(Number(element.dataset.resetAt));
  });
  const current = state.snapshot.current;
  if (current?.hasTokenData) {
    const workspace = folderName(current.cwd);
    elements.sessionMeta.textContent = [current.originator || 'Codex', workspace, `updated ${relativeTime(current.updatedAt)}`].filter(Boolean).join('  ·  ');
  }
}

function renderError(message) {
  state.snapshot = {
    status: 'error',
    error: message,
    current: null,
    sessions: [],
    summary: { discoveredSessions: 0, activeSessions: 0 },
    scannedAt: new Date().toISOString(),
  };
  renderSnapshot(state.snapshot);
}

async function chooseSource() {
  const sourceDir = await api.chooseSource();
  if (!sourceDir) return;
  state.selectedSessionId = null;
  await saveSetting({ sourceDir });
  showToast('Sessions folder updated');
}

async function resetSettings() {
  state.settings = await api.resetSettings();
  state.selectedSessionId = null;
  applySettings(state.settings);
  startRefreshTimer();
  await refresh({ force: true });
  showToast('Settings reset');
}

function openSettings() {
  elements.settingsPanel.classList.add('open');
  elements.settingsPanel.setAttribute('aria-hidden', 'false');
  $('settingsClose').focus();
}

function closeSettings() {
  elements.settingsPanel.classList.remove('open');
  elements.settingsPanel.setAttribute('aria-hidden', 'true');
  $('settingsButton').focus();
}

function showToast(message) {
  elements.toast.querySelector('span').textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove('show'), 1800);
}

function setMetric(element, value) {
  element.textContent = formatNumber(value);
  element.title = exactNumber(value);
}

function formatNumber(value) {
  const number = Number(value) || 0;
  if (number < 1000) return new Intl.NumberFormat().format(number);
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: number >= 1000000 ? 2 : 1,
  }).format(number);
}

function exactNumber(value) {
  return `${new Intl.NumberFormat().format(Number(value) || 0)} tokens`;
}

function formatPercent(value) {
  const number = Number(value) || 0;
  return `${number % 1 === 0 ? number.toFixed(0) : number.toFixed(1)}%`;
}

function formatPlan(plan) {
  if (!plan) return 'CODEX';
  return String(plan).replace(/[_-]/g, ' ').toUpperCase();
}

function formatWindow(minutes, fallback) {
  if (minutes === 10080) return 'Weekly limit';
  if (minutes === 1440) return 'Daily limit';
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hour limit`;
  if (minutes) return `${minutes} minute limit`;
  return fallback === 'primary' ? 'Primary limit' : 'Secondary limit';
}

function resetText(epochSeconds) {
  if (!epochSeconds) return 'Reset time unavailable';
  const resetAt = new Date(epochSeconds * 1000);
  const difference = resetAt.getTime() - Date.now();
  if (difference <= 0) return 'Resetting now';

  const totalMinutes = Math.ceil(difference / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const relative = days > 0
    ? `Resets in ${days}d ${hours}h`
    : hours > 0
      ? `Resets in ${hours}h ${minutes}m`
      : `Resets in ${minutes}m`;
  const absolute = new Intl.DateTimeFormat(undefined, {
    ...(days > 0 ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(resetAt);
  return `${relative} · ${absolute}`;
}

function relativeTime(dateValue) {
  const timestamp = new Date(dateValue).getTime();
  if (!Number.isFinite(timestamp)) return 'recently';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function folderName(folderPath) {
  if (!folderPath) return '';
  const normalized = folderPath.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).pop() || normalized;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function capitalize(value) {
  const text = String(value || '');
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

init().catch((error) => renderError(error instanceof Error ? error.message : String(error)));

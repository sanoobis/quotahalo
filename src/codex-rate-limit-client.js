'use strict';

const { execFileSync, spawn } = require('node:child_process');

const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

function firstLine(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function resolveCodexCommand(explicitCommand = process.env.CODEX_BIN) {
  if (explicitCommand) return explicitCommand;
  if (process.platform !== 'win32') return 'codex';

  // Prefer the command shim when both are present. WindowsApps package paths can
  // be discoverable through `where.exe` but still reject direct child-process launches.
  for (const candidate of ['codex.cmd', 'codex.exe']) {
    try {
      const found = firstLine(execFileSync('where.exe', [candidate], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1_500,
        windowsHide: true,
      }));
      if (found) return found;
    } catch {
      // Continue to the regular Windows command resolution fallback.
    }
  }

  return 'codex.cmd';
}

function normalizeWindow(window) {
  if (!window) return null;
  const usedPercent = numberOrNull(window.usedPercent ?? window.used_percent);
  if (usedPercent === null) return null;
  return {
    usedPercent,
    windowMinutes: numberOrNull(
      window.windowDurationMins
      ?? window.window_minutes
      ?? (window.limit_window_seconds == null ? null : Number(window.limit_window_seconds) / 60),
    ) || 0,
    resetsAt: numberOrNull(window.resetsAt ?? window.resets_at ?? window.reset_at) || 0,
  };
}

function normalizeSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    planType: snapshot.planType ?? snapshot.plan_type ?? null,
    limitId: snapshot.limitId ?? snapshot.limit_id ?? null,
    limitName: snapshot.limitName ?? snapshot.limit_name ?? null,
    reachedType: snapshot.rateLimitReachedType ?? snapshot.rate_limit_reached_type ?? null,
    primary: normalizeWindow(snapshot.primary ?? snapshot.primary_window),
    secondary: normalizeWindow(snapshot.secondary ?? snapshot.secondary_window),
    credits: snapshot.credits || null,
  };
}

function normalizeRateLimitResponse(response) {
  if (!response) return null;
  const buckets = response.rateLimitsByLimitId ?? response.rate_limits_by_limit_id ?? null;
  const core = buckets?.codex
    ?? response.rateLimits
    ?? response.rate_limits
    ?? response;
  return normalizeSnapshot(core);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

class CodexRateLimitClient {
  constructor(options = {}) {
    this.command = resolveCodexCommand(options.command);
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.spawn = options.spawn || spawn;
    this.child = null;
    this.buffer = '';
    this.pending = new Map();
    this.nextId = 1;
    this.initialized = null;
    this.refreshPromise = null;
    this.cached = null;
    this.checkedAt = 0;
    this.lastError = null;
    this.stderrTail = '';
    this.closed = false;
  }

  getState() {
    return {
      rateLimits: this.cached,
      checkedAt: this.checkedAt ? new Date(this.checkedAt).toISOString() : null,
      status: this.cached ? (this.lastError ? 'stale' : 'live') : this.lastError ? 'unavailable' : 'loading',
      error: this.lastError,
    };
  }

  async read(options = {}) {
    const force = Boolean(options.force);
    if (!force && this.checkedAt && Date.now() - this.checkedAt < this.cacheTtlMs
      && (this.cached || this.lastError)) return this.cached;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.performRead().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async performRead() {
    try {
      await this.ensureInitialized();
      const response = await this.request('account/rateLimits/read', null);
      const normalized = normalizeRateLimitResponse(response);
      if (!normalized) throw new Error('Codex returned no rate-limit snapshot');
      this.cached = normalized;
      this.checkedAt = Date.now();
      this.lastError = null;
      return normalized;
    } catch (error) {
      this.checkedAt = Date.now();
      this.lastError = safeError(error);
      throw error;
    }
  }

  ensureInitialized() {
    if (this.closed) return Promise.reject(new Error('Codex rate-limit client is closed'));
    if (this.initialized) return this.initialized;
    this.startProcess();
    this.initialized = this.request('initialize', {
      clientInfo: { name: 'quotahalo', title: 'QuotaHalo', version: '1' },
      capabilities: { experimentalApi: true },
    }).then((result) => {
      this.send({ method: 'initialized' });
      return result;
    }).catch((error) => {
      this.stopProcess(error);
      throw error;
    });
    return this.initialized;
  }

  startProcess() {
    if (this.child) return;
    const isCommandShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(this.command);
    if (isCommandShim && /["\r\n]/.test(this.command)) throw new Error('Invalid Codex command path');
    const executable = isCommandShim ? process.env.ComSpec || 'cmd.exe' : this.command;
    const args = isCommandShim
      ? ['/d', '/s', '/c', `call "${this.command}" app-server --listen stdio://`]
      : ['app-server', '--listen', 'stdio://'];
    const child = this.spawn(executable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: isCommandShim,
      shell: false,
    });
    this.child = child;
    child.stdout.on('data', (chunk) => this.handleStdout(chunk));
    child.stderr.on('data', (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(-2_000);
    });
    child.once('error', (error) => this.stopProcess(error));
    child.once('exit', (code, signal) => {
      if (child !== this.child) return;
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      this.stopProcess(new Error(`Codex app-server exited with ${detail}`), child);
    });
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} request timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.send({ method, id, params });
    });
  }

  send(message) {
    if (!this.child?.stdin?.writable) throw new Error('Codex app-server is unavailable');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  handleStdout(chunk) {
    this.buffer += chunk.toString('utf8');
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id === undefined || message.id === null) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
    }
  }

  stopProcess(error = new Error('Codex app-server stopped'), expectedChild = this.child) {
    if (expectedChild !== this.child) return;
    const child = this.child;
    this.child = null;
    this.initialized = null;
    this.buffer = '';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (child && !child.killed) child.kill();
  }

  close() {
    this.closed = true;
    this.stopProcess(new Error('Codex rate-limit client closed'));
  }
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/authentication required|not logged in/i.test(message)) return 'Codex account session is unavailable';
  if (/ENOENT|not recognized|cannot find/i.test(message)) return 'Codex command was not found';
  return message.slice(0, 240);
}

module.exports = {
  CodexRateLimitClient,
  normalizeRateLimitResponse,
  normalizeSnapshot,
  normalizeWindow,
  resolveCodexCommand,
};

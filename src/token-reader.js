'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TAIL_BYTES = 4 * 1024 * 1024;
const HEAD_BYTES = 1024 * 1024;
const MAX_RECENT_SESSIONS = 12;

function defaultCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function defaultSessionsPath() {
  return path.join(defaultCodexHome(), 'sessions');
}

function extractSessionId(filePath) {
  const match = path.basename(filePath).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : path.basename(filePath, path.extname(filePath));
}

function readSlice(filePath, start, length) {
  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = fs.readSync(handle, buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    fs.closeSync(handle);
  }
}

function readTail(filePath, maxBytes = TAIL_BYTES) {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  let text = readSlice(filePath, start, stat.size - start);

  // A tail read can start in the middle of a JSONL record. Discard that fragment.
  if (start > 0) {
    const firstNewline = text.indexOf('\n');
    text = firstNewline === -1 ? '' : text.slice(firstNewline + 1);
  }

  return text;
}

function readSessionMeta(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const head = readSlice(filePath, 0, Math.min(stat.size, HEAD_BYTES));
    const firstLineEnd = head.indexOf('\n');
    const firstLine = firstLineEnd === -1 ? head : head.slice(0, firstLineEnd);
    const record = JSON.parse(firstLine.replace(/\r$/, ''));

    if (record.type !== 'session_meta') return {};
    const payload = record.payload || {};
    return {
      id: payload.id || payload.session_id,
      cwd: payload.cwd || '',
      originator: payload.originator || 'Codex',
      cliVersion: payload.cli_version || '',
      source: payload.source || '',
      startedAt: payload.timestamp || record.timestamp || null,
    };
  } catch {
    return {};
  }
}

function parseTokenRecords(text) {
  const records = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (!line.includes('"token_count"')) continue;

    try {
      const record = JSON.parse(line);
      if (record.type !== 'event_msg' || record.payload?.type !== 'token_count') continue;
      const info = record.payload.info;
      if (!info?.total_token_usage) continue;

      records.push({
        timestamp: record.timestamp || null,
        total: normalizeUsage(info.total_token_usage),
        last: normalizeUsage(info.last_token_usage || {}),
        contextWindow: finiteNumber(info.model_context_window),
        rateLimits: normalizeRateLimits(record.payload.rate_limits),
      });
    } catch {
      // Codex may still be writing the final JSONL line. The next refresh will retry it.
    }
  }

  return records;
}

function normalizeUsage(usage) {
  return {
    inputTokens: finiteNumber(usage.input_tokens),
    cachedInputTokens: finiteNumber(usage.cached_input_tokens),
    outputTokens: finiteNumber(usage.output_tokens),
    reasoningOutputTokens: finiteNumber(usage.reasoning_output_tokens),
    totalTokens: finiteNumber(usage.total_tokens),
  };
}

function normalizeRateLimits(rateLimits) {
  if (!rateLimits) return null;
  return {
    planType: rateLimits.plan_type || null,
    limitId: rateLimits.limit_id || null,
    reachedType: rateLimits.rate_limit_reached_type || null,
    primary: normalizeLimitWindow(rateLimits.primary),
    secondary: normalizeLimitWindow(rateLimits.secondary),
    credits: rateLimits.credits || null,
  };
}

function normalizeLimitWindow(window) {
  if (!window) return null;
  return {
    usedPercent: finiteNumber(window.used_percent),
    windowMinutes: finiteNumber(window.window_minutes),
    resetsAt: finiteNumber(window.resets_at),
  };
}

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function collectJsonlFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  const pending = [rootDir];

  while (pending.length) {
    const current = pending.pop();
    let entries;

    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(fullPath);
    }
  }

  return files;
}

function loadThreadNames(indexPath = path.join(defaultCodexHome(), 'session_index.jsonl')) {
  const names = new Map();
  if (!fs.existsSync(indexPath)) return names;

  try {
    const text = fs.readFileSync(indexPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item.id && item.thread_name) names.set(item.id, item.thread_name);
      } catch {
        // Ignore a partially written index record.
      }
    }
  } catch {
    return names;
  }

  return names;
}

function fallbackTitle(meta, id) {
  if (meta.cwd) {
    const folder = path.basename(meta.cwd);
    if (folder) return folder;
  }
  return `Codex session ${id.slice(0, 8)}`;
}

function parseSessionFile(filePath, names = new Map(), stat = fs.statSync(filePath)) {
  const idFromName = extractSessionId(filePath);
  const meta = readSessionMeta(filePath);
  const id = meta.id || idFromName;
  const tokenRecords = parseTokenRecords(readTail(filePath));
  const latest = tokenRecords.at(-1) || null;
  const activity = tokenRecords.slice(-36).map((record) => ({
    timestamp: record.timestamp,
    contextTokens: record.last.totalTokens,
    cumulativeTokens: record.total.totalTokens,
  }));

  return {
    id,
    title: names.get(id) || fallbackTitle(meta, id),
    cwd: meta.cwd || '',
    originator: meta.originator || 'Codex',
    cliVersion: meta.cliVersion || '',
    source: meta.source || '',
    startedAt: meta.startedAt,
    updatedAt: latest?.timestamp || stat.mtime.toISOString(),
    fileUpdatedAt: stat.mtime.toISOString(),
    filePath,
    fileSize: stat.size,
    hasTokenData: Boolean(latest),
    total: latest?.total || normalizeUsage({}),
    last: latest?.last || normalizeUsage({}),
    contextWindow: latest?.contextWindow || 0,
    rateLimits: latest?.rateLimits || null,
    activity,
  };
}

class TokenReader {
  constructor(options = {}) {
    this.sourceDir = options.sourceDir || defaultSessionsPath();
    this.indexPath = options.indexPath || path.join(defaultCodexHome(), 'session_index.jsonl');
    this.fileCache = new Map();
    this.knownFiles = [];
    this.lastDiscovery = 0;
    this.names = new Map();
    this.namesMtime = 0;
  }

  setSourceDir(sourceDir) {
    if (sourceDir === this.sourceDir) return;
    this.sourceDir = sourceDir;
    this.knownFiles = [];
    this.fileCache.clear();
    this.lastDiscovery = 0;
  }

  refreshNames() {
    try {
      const mtime = fs.statSync(this.indexPath).mtimeMs;
      if (mtime !== this.namesMtime) {
        this.names = loadThreadNames(this.indexPath);
        this.namesMtime = mtime;
      }
    } catch {
      this.names = new Map();
    }
  }

  discoverFiles(force = false) {
    const now = Date.now();
    if (force || !this.knownFiles.length || now - this.lastDiscovery > 30_000) {
      this.knownFiles = collectJsonlFiles(this.sourceDir);
      this.lastDiscovery = now;
    }
    return this.knownFiles;
  }

  snapshot(options = {}) {
    this.refreshNames();
    const files = this.discoverFiles(Boolean(options.force));
    const candidates = [];

    for (const filePath of files) {
      try {
        const stat = fs.statSync(filePath);
        candidates.push({ filePath, stat });
      } catch {
        // A session can be archived between discovery and stat.
      }
    }

    candidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    const wantedId = options.sessionId || null;
    const selected = [];

    if (wantedId) {
      const requested = candidates.find(({ filePath }) => extractSessionId(filePath) === wantedId);
      if (requested) selected.push(requested);
    }

    for (const candidate of candidates) {
      if (selected.length >= MAX_RECENT_SESSIONS) break;
      if (!selected.some((item) => item.filePath === candidate.filePath)) selected.push(candidate);
    }

    const sessions = selected.map(({ filePath, stat }) => {
      const cacheKey = `${stat.size}:${stat.mtimeMs}:${this.names.get(extractSessionId(filePath)) || ''}`;
      const cached = this.fileCache.get(filePath);
      if (cached?.key === cacheKey) return cached.value;
      const value = parseSessionFile(filePath, this.names, stat);
      this.fileCache.set(filePath, { key: cacheKey, value });
      return value;
    });

    const current = wantedId
      ? sessions.find((session) => session.id === wantedId) || sessions[0]
      : sessions[0];
    const activeCutoff = Date.now() - 30 * 60 * 1000;
    const recentWithData = sessions.filter((session) => session.hasTokenData);

    return {
      sourceDir: this.sourceDir,
      scannedAt: new Date().toISOString(),
      status: current?.hasTokenData ? 'live' : 'waiting',
      current: current || null,
      sessions: sessions.slice(0, 8),
      summary: {
        discoveredSessions: candidates.length,
        visibleSessions: sessions.length,
        activeSessions: candidates.filter(({ stat }) => stat.mtimeMs >= activeCutoff).length,
        tokensAcrossRecent: recentWithData.reduce((sum, session) => sum + session.total.totalTokens, 0),
      },
    };
  }
}

module.exports = {
  TokenReader,
  collectJsonlFiles,
  defaultCodexHome,
  defaultSessionsPath,
  extractSessionId,
  loadThreadNames,
  normalizeRateLimits,
  normalizeUsage,
  parseSessionFile,
  parseTokenRecords,
  readTail,
};

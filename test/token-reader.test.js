'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  TokenReader,
  activeRateLimits,
  extractSessionId,
  mergeRateLimits,
  parseSessionFile,
  parseTokenRecords,
  readTail,
} = require('../src/token-reader');
const { SnapshotService } = require('../src/snapshot-service');

const SESSION_ID = '019f4ccd-1d6a-7353-9564-7adc619a3359';

function tokenLine(total = 4500, context = 1250) {
  return JSON.stringify({
    timestamp: '2026-07-10T16:12:01.575Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 4000,
          cached_input_tokens: 2500,
          output_tokens: 500,
          reasoning_output_tokens: 200,
          total_tokens: total,
        },
        last_token_usage: {
          input_tokens: 1000,
          cached_input_tokens: 700,
          output_tokens: 250,
          reasoning_output_tokens: 80,
          total_tokens: context,
        },
        model_context_window: 200000,
      },
      rate_limits: {
        primary: { used_percent: 23, window_minutes: 300, resets_at: 1783715653 },
        secondary: { used_percent: 4, window_minutes: 10080, resets_at: 1784302453 },
        plan_type: 'pro',
      },
    },
  });
}

test('extractSessionId reads UUID from a rollout filename', () => {
  assert.equal(extractSessionId(`rollout-2026-07-10T20-12-23-${SESSION_ID}.jsonl`), SESSION_ID);
});

test('parseTokenRecords ignores unrelated and partial JSONL records', () => {
  const records = parseTokenRecords([
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
    tokenLine(),
    '{"type":"event_msg","payload":{"type":"token_count"',
  ].join('\n'));

  assert.equal(records.length, 1);
  assert.equal(records[0].total.totalTokens, 4500);
  assert.equal(records[0].last.cachedInputTokens, 700);
  assert.equal(records[0].contextWindow, 200000);
  assert.equal(records[0].rateLimits.primary.usedPercent, 23);
});

test('readTail discards a partial first line', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quotahalo-tail-'));
  const file = path.join(directory, 'session.jsonl');
  fs.writeFileSync(file, `${'x'.repeat(200)}\n${tokenLine()}\n`, 'utf8');

  const tail = readTail(file, Buffer.byteLength(tokenLine()) + 2);
  assert.equal(parseTokenRecords(tail).length, 1);

  fs.rmSync(directory, { recursive: true, force: true });
});

test('TokenReader returns a named live snapshot', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quotahalo-reader-'));
  const sessions = path.join(directory, 'sessions', '2026', '07', '10');
  fs.mkdirSync(sessions, { recursive: true });
  const file = path.join(sessions, `rollout-${SESSION_ID}.jsonl`);
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'session_meta', payload: { id: SESSION_ID, cwd: 'D:\\Work\\Radar', originator: 'Codex Desktop' } }),
    tokenLine(),
  ].join('\n'), 'utf8');
  const index = path.join(directory, 'session_index.jsonl');
  fs.writeFileSync(index, JSON.stringify({ id: SESSION_ID, thread_name: 'Build QuotaHalo' }), 'utf8');

  const reader = new TokenReader({ sourceDir: path.join(directory, 'sessions'), indexPath: index });
  const snapshot = reader.snapshot();

  assert.equal(snapshot.status, 'live');
  assert.equal(snapshot.current.title, 'Build QuotaHalo');
  assert.equal(snapshot.current.total.totalTokens, 4500);
  assert.equal(snapshot.summary.discoveredSessions, 1);

  fs.rmSync(directory, { recursive: true, force: true });
});

test('parseSessionFile keeps the latest available rate limits', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quotahalo-limits-'));
  const file = path.join(directory, `rollout-${SESSION_ID}.jsonl`);
  const withoutLimits = JSON.parse(tokenLine(5000, 1500));
  delete withoutLimits.payload.rate_limits;
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'session_meta', payload: { id: SESSION_ID, cwd: 'D:\\Work\\Radar' } }),
    tokenLine(),
    JSON.stringify(withoutLimits),
  ].join('\n'), 'utf8');

  const session = parseSessionFile(file);
  assert.equal(session.total.totalTokens, 5000);
  assert.equal(session.rateLimits.primary.usedPercent, 23);

  fs.rmSync(directory, { recursive: true, force: true });
});

test('mergeRateLimits restores 5-hour and weekly windows from partial updates', () => {
  const merged = mergeRateLimits([
    {
      planType: 'pro',
      primary: { usedPercent: 12, windowMinutes: 10080, resetsAt: 300 },
      secondary: null,
    },
    {
      planType: 'pro',
      primary: { usedPercent: 35, windowMinutes: 300, resetsAt: 200 },
      secondary: { usedPercent: 10, windowMinutes: 10080, resetsAt: 250 },
    },
  ]);

  assert.equal(merged.primary.windowMinutes, 300);
  assert.equal(merged.primary.usedPercent, 35);
  assert.equal(merged.secondary.windowMinutes, 10080);
  assert.equal(merged.secondary.usedPercent, 12);
});

test('activeRateLimits drops expired quota windows instead of showing stale data', () => {
  const active = activeRateLimits({
    planType: 'pro',
    primary: { usedPercent: 90, windowMinutes: 300, resetsAt: 900 },
    secondary: { usedPercent: 20, windowMinutes: 10080, resetsAt: 2000 },
  }, 1000);

  assert.equal(active.primary, null);
  assert.equal(active.secondary.windowMinutes, 10080);
});

test('TokenReader keeps live data visible while a new thread warms up', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quotahalo-switch-'));
  const sessions = path.join(directory, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const liveId = '11111111-1111-4111-8111-111111111111';
  const waitingId = '22222222-2222-4222-8222-222222222222';
  const liveFile = path.join(sessions, `rollout-${liveId}.jsonl`);
  const waitingFile = path.join(sessions, `rollout-${waitingId}.jsonl`);
  fs.writeFileSync(liveFile, [
    JSON.stringify({ type: 'session_meta', payload: { id: liveId, cwd: 'D:\\Work\\Live' } }),
    tokenLine(),
  ].join('\n'), 'utf8');
  fs.writeFileSync(waitingFile, JSON.stringify({
    type: 'session_meta',
    payload: { id: waitingId, cwd: 'D:\\Work\\Waiting' },
  }), 'utf8');
  const now = Date.now() / 1000;
  fs.utimesSync(liveFile, now - 10, now - 10);
  fs.utimesSync(waitingFile, now, now);

  const reader = new TokenReader({ sourceDir: sessions, indexPath: path.join(directory, 'missing-index.jsonl') });
  const warming = reader.snapshot({ force: true });
  assert.equal(warming.current.id, liveId);
  assert.equal(warming.current.hasTokenData, true);

  fs.appendFileSync(waitingFile, `\n${tokenLine(100, 100)}`, 'utf8');
  const switched = reader.snapshot({ force: true });
  assert.equal(switched.current.id, waitingId);
  assert.equal(switched.current.hasTokenData, true);

  fs.rmSync(directory, { recursive: true, force: true });
});

test('SnapshotService scans without blocking the caller event loop', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quotahalo-worker-'));
  const sessions = path.join(directory, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, `rollout-${SESSION_ID}.jsonl`), [
    JSON.stringify({ type: 'session_meta', payload: { id: SESSION_ID, cwd: 'D:\\Work\\Worker' } }),
    tokenLine(),
  ].join('\n'), 'utf8');
  const service = new SnapshotService({ sourceDir: sessions, indexPath: path.join(directory, 'missing-index.jsonl') });

  const pending = service.snapshot({ force: true });
  let yielded = false;
  await new Promise((resolve) => setImmediate(() => {
    yielded = true;
    resolve();
  }));
  const snapshot = await pending;
  assert.equal(yielded, true);
  assert.equal(snapshot.current.id, SESSION_ID);

  await service.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

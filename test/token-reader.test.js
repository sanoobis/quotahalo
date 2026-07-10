'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  TokenReader,
  extractSessionId,
  parseTokenRecords,
  readTail,
} = require('../src/token-reader');

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

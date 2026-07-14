'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const {
  CodexRateLimitClient,
  normalizeRateLimitResponse,
} = require('../src/codex-rate-limit-client');
const { applyQuotaState } = require('../src/quota-state');

function liveResponse() {
  return {
    rateLimits: {
      limitId: 'codex',
      planType: 'prolite',
      primary: { usedPercent: 50, windowDurationMins: 10080, resetsAt: 2_000_000_000 },
      secondary: null,
    },
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex',
        planType: 'prolite',
        primary: { usedPercent: 50, windowDurationMins: 10080, resetsAt: 2_000_000_000 },
        secondary: null,
      },
      codex_optional_model: {
        limitId: 'codex_optional_model',
        primary: { usedPercent: 2, windowDurationMins: 10080, resetsAt: 2_000_000_000 },
      },
    },
  };
}

function fakeAppServer(response = liveResponse()) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  child.stdin = {
    writable: true,
    write(line) {
      const message = JSON.parse(line);
      if (message.method === 'initialize') {
        setImmediate(() => child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'test' } })}\n`));
      } else if (message.method === 'account/rateLimits/read') {
        setImmediate(() => child.stdout.write(`${JSON.stringify({ id: message.id, result: response })}\n`));
      }
    },
  };
  return child;
}

test('normalizes the core Codex bucket from the multi-limit account response', () => {
  const limits = normalizeRateLimitResponse(liveResponse());
  assert.equal(limits.limitId, 'codex');
  assert.equal(limits.planType, 'prolite');
  assert.equal(limits.primary.windowMinutes, 10080);
  assert.equal(limits.primary.usedPercent, 50);
});

test('CodexRateLimitClient performs the official app-server handshake and caches the result', async () => {
  let spawns = 0;
  const client = new CodexRateLimitClient({
    command: 'codex-test',
    spawn: () => { spawns += 1; return fakeAppServer(); },
    requestTimeoutMs: 500,
  });

  const first = await client.read();
  const second = await client.read();
  assert.equal(first.primary.windowMinutes, 10080);
  assert.equal(second, first);
  assert.equal(spawns, 1);
  assert.equal(client.getState().status, 'live');
  client.close();
});

test('CodexRateLimitClient backs off after launch failures instead of spawning every refresh', async () => {
  let spawns = 0;
  const client = new CodexRateLimitClient({
    command: 'missing-codex',
    spawn: () => {
      spawns += 1;
      throw new Error('spawn EPERM');
    },
    cacheTtlMs: 60_000,
  });

  await assert.rejects(client.read(), /spawn EPERM/);
  assert.equal(client.getState().status, 'unavailable');
  assert.equal(await client.read(), null);
  assert.equal(spawns, 1);
  client.close();
});

test('weekly-only live data is classified explicitly instead of leaving a blank 5-hour gauge', () => {
  const snapshot = applyQuotaState({
    status: 'live',
    current: { hasTokenData: true, rateLimits: null },
  }, {
    status: 'live',
    checkedAt: '2026-07-14T10:00:00.000Z',
    rateLimits: normalizeRateLimitResponse(liveResponse()),
  });

  assert.equal(snapshot.current.rateLimits.primary, null);
  assert.equal(snapshot.current.rateLimits.secondary.windowMinutes, 10080);
  assert.equal(snapshot.quota.fiveHour, 'not-reported');
  assert.equal(snapshot.quota.weekly, 'available');
  assert.equal(snapshot.quota.source, 'codex-account');
});

test('live weekly data merges with a valid 5-hour session window', () => {
  const snapshot = applyQuotaState({
    current: {
      hasTokenData: true,
      rateLimits: {
        planType: 'prolite',
        primary: { usedPercent: 25, windowMinutes: 300, resetsAt: 2_000_000_000 },
        secondary: null,
      },
    },
  }, { rateLimits: normalizeRateLimitResponse(liveResponse()), status: 'live' });

  assert.equal(snapshot.current.rateLimits.primary.windowMinutes, 300);
  assert.equal(snapshot.current.rateLimits.secondary.windowMinutes, 10080);
  assert.equal(snapshot.quota.fiveHour, 'available');
  assert.equal(snapshot.quota.weekly, 'available');
});

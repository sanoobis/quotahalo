'use strict';

const { activeRateLimits, mergeRateLimits } = require('./token-reader');

function applyQuotaState(snapshot, liveState = {}) {
  const current = snapshot?.current || null;
  const live = activeRateLimits(liveState.rateLimits);
  const session = activeRateLimits(current?.rateLimits);
  const merged = mergeRateLimits([live, session]);
  const windows = [merged?.primary, merged?.secondary].filter(Boolean);
  const hasFiveHour = windows.some((window) => near(window.windowMinutes, 300));
  const hasWeekly = windows.some((window) => near(window.windowMinutes, 10080));
  const source = live ? 'codex-account' : session ? 'session-events' : 'none';

  return {
    ...snapshot,
    current: current && merged ? { ...current, rateLimits: merged } : current,
    quota: {
      status: live
        ? liveState.status === 'stale' ? 'stale' : 'live'
        : liveState.status === 'loading' ? 'loading' : source === 'session-events' ? 'fallback' : 'unavailable',
      source,
      checkedAt: liveState.checkedAt || null,
      fiveHour: hasFiveHour ? 'available' : 'not-reported',
      weekly: hasWeekly ? 'available' : 'not-reported',
      windows: windows.map((window) => window.windowMinutes).filter(Boolean),
      error: live ? null : liveState.error || null,
    },
  };
}

function near(value, target) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && Math.abs(number - target) <= target * 0.05;
}

module.exports = { applyQuotaState, near };

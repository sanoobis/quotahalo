'use strict';

const { performance } = require('node:perf_hooks');
const { CodexRateLimitClient } = require('../src/codex-rate-limit-client');
const { applyQuotaState } = require('../src/quota-state');
const { SnapshotService } = require('../src/snapshot-service');

async function main() {
  const strict = process.argv.includes('--strict');
  const service = new SnapshotService({ enableLiveRateLimits: false });
  const quotaClient = new CodexRateLimitClient();
  const timings = [];

  try {
    for (let index = 0; index < 12; index += 1) {
      const started = performance.now();
      const snapshot = await service.snapshot({ force: index === 0 });
      timings.push(performance.now() - started);
      if (snapshot.status === 'error') throw new Error(snapshot.error || 'Snapshot failed');
    }

    let quotaError = null;
    try {
      await quotaClient.read({ force: true });
    } catch (error) {
      quotaError = error instanceof Error ? error.message : String(error);
    }
    const quota = applyQuotaState(await service.snapshot(), quotaClient.getState()).quota;
    if (strict && quota.source !== 'codex-account') {
      throw new Error(`Live Codex quota feed unavailable: ${quotaError || quota.error || 'unknown error'}`);
    }

    const sorted = [...timings].sort((a, b) => a - b);
    const summary = {
      status: quota.source === 'codex-account' ? 'healthy' : 'healthy-with-notice',
      workerResponsive: true,
      discoveredSessions: (await service.snapshot()).summary.discoveredSessions,
      coldScanMs: Number(timings[0].toFixed(1)),
      medianWarmScanMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(1)),
      slowestScanMs: Number(Math.max(...timings).toFixed(1)),
      quotaFeed: quota.source,
      quotaWindowsMinutes: quota.windows,
      fiveHourWindow: quota.fiveHour,
      weeklyWindow: quota.weekly,
      quotaNotice: quota.source === 'codex-account' ? null : quotaError || quota.error,
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    quotaClient.close();
    await service.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

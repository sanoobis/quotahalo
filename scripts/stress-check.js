'use strict';

const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const { SnapshotService } = require('../src/snapshot-service');

async function main() {
  const service = new SnapshotService();
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  const timings = [];
  let mismatches = 0;
  eventLoop.enable();

  try {
    const first = await service.snapshot({ force: true });
    const sessionIds = first.sessions.filter((session) => session.hasTokenData).map((session) => session.id);
    if (!sessionIds.length) throw new Error('No Codex sessions with token data were found');

    for (let index = 0; index < 120; index += 1) {
      const sessionId = sessionIds[index % sessionIds.length];
      const started = performance.now();
      const snapshot = await service.snapshot({ sessionId });
      timings.push(performance.now() - started);
      if (snapshot.current?.id !== sessionId) mismatches += 1;
    }

    const sorted = [...timings].sort((a, b) => a - b);
    const percentile = (value) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))];
    const summary = {
      status: mismatches === 0 ? 'healthy' : 'failed',
      snapshots: timings.length,
      switchedSessions: sessionIds.length,
      mismatches,
      quotaFeed: first.quota?.source || 'none',
      fiveHourWindow: first.quota?.fiveHour || 'unknown',
      weeklyWindow: first.quota?.weekly || 'unknown',
      medianMs: Number(percentile(0.5).toFixed(1)),
      p95Ms: Number(percentile(0.95).toFixed(1)),
      slowestMs: Number(Math.max(...timings).toFixed(1)),
      maxEventLoopDelayMs: Number((eventLoop.max / 1e6).toFixed(1)),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (mismatches) process.exitCode = 1;
  } finally {
    eventLoop.disable();
    await service.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

'use strict';

const { performance } = require('node:perf_hooks');
const { SnapshotService } = require('../src/snapshot-service');

async function main() {
  const service = new SnapshotService();
  const timings = [];

  try {
    for (let index = 0; index < 12; index += 1) {
      const started = performance.now();
      const snapshot = await service.snapshot({ force: index === 0 });
      timings.push(performance.now() - started);
      if (snapshot.status === 'error') throw new Error(snapshot.error || 'Snapshot failed');
    }

    const sorted = [...timings].sort((a, b) => a - b);
    const summary = {
      status: 'healthy',
      workerResponsive: true,
      discoveredSessions: (await service.snapshot()).summary.discoveredSessions,
      coldScanMs: Number(timings[0].toFixed(1)),
      medianWarmScanMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(1)),
      slowestScanMs: Number(Math.max(...timings).toFixed(1)),
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await service.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

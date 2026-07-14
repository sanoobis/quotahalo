'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { CodexRateLimitClient } = require('./codex-rate-limit-client');
const { applyQuotaState } = require('./quota-state');
const { TokenReader } = require('./token-reader');

const reader = new TokenReader(workerData || {});
const liveQuotaEnabled = workerData?.enableLiveRateLimits !== false;
const quotaClient = liveQuotaEnabled ? new CodexRateLimitClient({ command: workerData?.codexCommand }) : null;

quotaClient?.read().catch(() => {
  // Session events remain available while the account feed is unavailable.
});

parentPort.on('message', async (message) => {
  const { id, type } = message || {};
  if (!id) return;

  try {
    let result;
    if (type === 'snapshot') {
      result = reader.snapshot(message.options || {});
      if (quotaClient) {
        if (message.options?.force) await quotaClient.read({ force: true }).catch(() => null);
        else quotaClient.read().catch(() => null);
        result = applyQuotaState(result, quotaClient.getState());
      } else {
        result = applyQuotaState(result);
      }
    }
    else if (type === 'set-source') {
      reader.setSourceDir(message.sourceDir);
      result = true;
    } else if (type === 'close') {
      quotaClient?.close();
      result = true;
    } else throw new Error(`Unknown token worker request: ${type}`);

    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

process.once('exit', () => quotaClient?.close());

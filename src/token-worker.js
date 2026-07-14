'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { TokenReader } = require('./token-reader');

const reader = new TokenReader(workerData || {});

parentPort.on('message', (message) => {
  const { id, type } = message || {};
  if (!id) return;

  try {
    let result;
    if (type === 'snapshot') result = reader.snapshot(message.options || {});
    else if (type === 'set-source') {
      reader.setSourceDir(message.sourceDir);
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

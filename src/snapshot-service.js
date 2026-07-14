'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const REQUEST_TIMEOUT_MS = 20_000;

class SnapshotService {
  constructor(options = {}) {
    this.options = { ...options };
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.worker = null;
    this.startWorker();
  }

  startWorker() {
    if (this.closed) return;
    const worker = new Worker(path.join(__dirname, 'token-worker.js'), { workerData: this.options });
    worker.unref();
    worker.on('message', (message) => this.handleMessage(message));
    worker.on('error', (error) => this.handleFailure(error, worker));
    worker.on('exit', (code) => {
      if (!this.closed && code !== 0) this.handleFailure(new Error(`Token worker exited with code ${code}`), worker);
    });
    this.worker = worker;
  }

  handleMessage(message) {
    const request = this.pending.get(message?.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
  }

  handleFailure(error, worker) {
    if (worker !== this.worker) return;
    this.worker = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    if (!this.closed) this.startWorker();
  }

  request(type, payload = {}) {
    if (this.closed) return Promise.reject(new Error('Snapshot service is closed'));
    if (!this.worker) this.startWorker();
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Token scan timed out'));
        const stalledWorker = this.worker;
        this.worker = null;
        stalledWorker?.terminate().catch(() => {});
        if (!this.closed) this.startWorker();
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, ...payload });
    });
  }

  snapshot(options = {}) {
    return this.request('snapshot', { options });
  }

  setSourceDir(sourceDir) {
    this.options.sourceDir = sourceDir;
    return this.request('set-source', { sourceDir });
  }

  async close() {
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Snapshot service closed'));
    }
    this.pending.clear();
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }
}

module.exports = { SnapshotService };

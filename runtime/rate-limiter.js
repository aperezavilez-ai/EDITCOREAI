"use strict";
/**
 * runtime/rate-limiter.js
 * Token bucket por clave.
 */

class RateLimiter {
  constructor({ capacity = 60, refillPerSec = 1 } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.buckets = new Map();
  }

  _bucket(key) {
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.capacity, last: Date.now() }; this.buckets.set(key, b); }
    return b;
  }

  _refill(b) {
    const now = Date.now();
    const elapsed = (now - b.last) / 1000;
    if (elapsed > 0) {
      b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);
      b.last = now;
    }
  }

  tryAcquire(key, cost = 1) {
    const b = this._bucket(key);
    this._refill(b);
    if (b.tokens >= cost) { b.tokens -= cost; return { ok: true, remaining: b.tokens }; }
    const waitMs = Math.ceil(((cost - b.tokens) / this.refillPerSec) * 1000);
    return { ok: false, remaining: b.tokens, waitMs };
  }

  async acquire(key, cost = 1, { maxWaitMs = 30000 } = {}) {
    const t0 = Date.now();
    while (true) {
      const r = this.tryAcquire(key, cost);
      if (r.ok) return r;
      if (Date.now() - t0 > maxWaitMs) throw new Error("rate-limiter: timeout");
      await new Promise((res) => setTimeout(res, Math.min(r.waitMs, 1000)));
    }
  }

  reset(key) { this.buckets.delete(key); }
}

module.exports = { RateLimiter };
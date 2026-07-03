import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from './retry.js';

test('returns result on first success without retrying', async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts++;
    return 'ok';
  }, { delayMs: 0 });

  assert.equal(result, 'ok');
  assert.equal(attempts, 1);
});

test('retries a failing operation and returns the eventual success', async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts++;
    if (attempts < 3) throw new Error('Request timed out after 60000ms');
    return 'ok';
  }, { retries: 2, delayMs: 0 });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('throws the last error after exhausting retries', async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(async () => {
      attempts++;
      throw new Error(`fail ${attempts}`);
    }, { retries: 2, delayMs: 0 }),
    /fail 3/
  );
  assert.equal(attempts, 3);
});

test('does not retry when shouldRetry returns false', async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(async () => {
      attempts++;
      throw new Error('Status code 403');
    }, { retries: 2, delayMs: 0, shouldRetry: (err) => !err.message.includes('403') }),
    /403/
  );
  assert.equal(attempts, 1);
});

test('calls onRetry with the error and attempt number before each retry', async () => {
  const seen = [];
  let attempts = 0;
  await withRetry(async () => {
    attempts++;
    if (attempts < 3) throw new Error(`fail ${attempts}`);
    return 'ok';
  }, { retries: 2, delayMs: 0, onRetry: (err, attempt) => seen.push([err.message, attempt]) });

  assert.deepEqual(seen, [['fail 1', 1], ['fail 2', 2]]);
});

test('waits delayMs between attempts', async () => {
  let attempts = 0;
  const start = Date.now();
  await withRetry(async () => {
    attempts++;
    if (attempts < 2) throw new Error('fail');
    return 'ok';
  }, { retries: 1, delayMs: 50 });

  assert.ok(Date.now() - start >= 45, 'expected at least ~50ms delay before retry');
});

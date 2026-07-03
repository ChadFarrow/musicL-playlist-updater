# Transient Feed Error Tolerance — Design

**Date:** 2026-07-03
**Status:** Approved

## Problem

The daily RSS feed update (`scripts/daily-update.js`, run by `.github/workflows/daily-feed-update.yml`) exits 1 whenever any feed errors and no playlist was updated. A single 60-second timeout on one feed marks the whole run red, and the red run also skips the commit step, so `lastChecked`/`lastEpisodeGuid` state is not saved. There is no retry: one blip on one feed fails the day. Example: run 28653097366 failed on two feed timeouts and a 403 while every other feed was fine.

## Design

### 1. Retry helper (`src/utils/retry.js`)

`withRetry(fn, { retries = 2, delayMs = 10000, shouldRetry, onRetry })`:

- Runs `fn`; on failure waits `delayMs` and tries again, up to `retries` retries (3 attempts total).
- `shouldRetry(error)` gates retrying; access errors (403/404/Forbidden/Not Found — the existing `isAccessError` logic, extracted so both the helper call site and the catch block share it) are **not** retried, since they won't clear in seconds.
- `onRetry(error, attempt)` lets the caller log e.g. `Retry 1/2 for Behind the Sch3m3s after error: Request timed out`.
- Unit-tested with `node --test` (first test file in the repo; `npm test` already points at `src/**/*.test.js`).

### 2. Wrap per-feed work

In the `daily-update.js` feed loop, `checkFeedForUpdates` + `generatePlaylistFromRSS` run inside `withRetry`. A feed that succeeds on a later attempt counts as a clean success.

### 3. Partial success = green run

Track `processedCount` (feeds that completed without error, whether or not they had updates). Exit 0 when `errorCount === 0` **or** `processedCount > 0`. Exit 1 only when every feed fails, or on a fatal error (unreadable config, etc.). Side effect (desired): the workflow's `if: success()` commit step now runs on partially-failing days, so feed state is saved.

### 4. Visibility without red runs

Each feed that still fails after all retries emits a GitHub Actions annotation
(`::warning title=Feed update failed::<name>: <error>`), so failures show on the
run summary page without failing the run.

## Out of scope

- No workflow YAML changes.
- No changes to the 403/404 non-fatal handling (kept as-is, minus retries).

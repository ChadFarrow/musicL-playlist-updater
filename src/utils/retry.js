const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run an async operation, retrying transient failures.
 *
 * @param {() => Promise<any>} fn - operation to run
 * @param {object} [options]
 * @param {number} [options.retries=2] - retries after the first attempt
 * @param {number} [options.delayMs=10000] - wait between attempts
 * @param {(error: Error) => boolean} [options.shouldRetry] - return false to rethrow immediately
 * @param {(error: Error, attempt: number) => void} [options.onRetry] - called before each retry
 */
export async function withRetry(fn, { retries = 2, delayMs = 10000, shouldRetry, onRetry } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt > retries || (shouldRetry && !shouldRetry(error))) {
        throw error;
      }
      if (onRetry) onRetry(error, attempt);
      if (delayMs > 0) await sleep(delayMs);
    }
  }
}

// 403/404-style errors won't clear on retry and shouldn't fail the run
export function isAccessError(error) {
  return !!error.message && (
    error.message.includes('Status code 403') ||
    error.message.includes('Status code 404') ||
    error.message.includes('403') ||
    error.message.includes('404') ||
    error.message.includes('Forbidden') ||
    error.message.includes('Not Found')
  );
}

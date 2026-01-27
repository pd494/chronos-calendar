export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RetryOptions {
  maxRetries?: number
  baseDelay?: number
  shouldRetry?: (error: unknown) => boolean
}

const DEFAULT_MAX_RETRIES = 5
const DEFAULT_BASE_DELAY_MS = 1000

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelay = DEFAULT_BASE_DELAY_MS,
    shouldRetry = () => true,
  } = options

  let lastError: unknown
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!shouldRetry(error)) throw error
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt)
        await sleep(delay)
      }
    }
  }
  throw lastError
}

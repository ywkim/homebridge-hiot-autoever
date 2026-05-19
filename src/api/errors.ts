/**
 * Base error for any Hi-oT API failure.
 *
 * Uses the standard Node.js `Error` `options.cause` so loggers (pino, etc.)
 * and debuggers can walk the cause chain automatically.
 */
export class HiotApiError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'HiotApiError';
  }
}

/**
 * Authentication failure (401, missing userkeyvalu in response, etc.).
 */
export class HiotAuthError extends HiotApiError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'HiotAuthError';
  }
}

/**
 * Transport-level failure (network, TLS, DNS, etc.) before an HTTP response is parsed.
 */
export class HiotConnectionError extends HiotApiError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'HiotConnectionError';
  }
}

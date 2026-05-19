/**
 * Base error for any Hi-oT API failure.
 */
export class HiotApiError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'HiotApiError';
    if (cause !== undefined) {
      this.cause = cause;
    }
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

/** Base class for all errors thrown by the ubilltu client. */
export class UbilltuError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UbilltuError';
  }
}

/** Thrown when the API returns a non-2xx response. */
export class UbilltuApiError extends UbilltuError {
  readonly statusCode: number;
  /** Decoded JSON error payload when available (e.g. `{ detail: ... }`). */
  readonly body?: unknown;

  constructor(statusCode: number, message: string, body?: unknown) {
    super(message);
    this.name = 'UbilltuApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

/** Thrown when an authenticated call is made before `login()`. */
export class UbilltuAuthError extends UbilltuError {
  constructor(message = 'Not authenticated — call login() first.') {
    super(message);
    this.name = 'UbilltuAuthError';
  }
}

// Typed errors (prd-api LIB-1) and the CLI's exit codes (CLI-16):
//   0 ok, 1 other error, 2 usage, 3 auth (401, 403), 4 conflict or unprocessable (409, 422), 5 rate limited (429).
// OPEN (#98): a 400 or 413 from the API (the request's shape was wrong) exits 2 like a usage error, not 1.

/** The API refused the request: its Error body ({ error, message, ...details }, protocol §14) and the HTTP status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown>,
    /** Seconds to wait, from a 429's Retry-After or its body. */
    readonly retryAfter: number | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** The request never got an answer (DNS, connection, TLS, a timeout), even after the retries. */
export class NetworkError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'NetworkError'
  }
}

/** Something on this side is wrong before anything is sent: a flag, a name, a file. `code` is what --json prints. */
export class UsageError extends Error {
  constructor(
    message: string,
    readonly code = 'usage',
  ) {
    super(message)
    this.name = 'UsageError'
  }
}

/** A refusal made here, without asking the server: no key, or an act only the bare handle can do (CLI-7). */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly code = 'no_key',
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export const EXIT = { ok: 0, other: 1, usage: 2, auth: 3, conflict: 4, rate_limited: 5 } as const

export function exitCodeFor(e: unknown): number {
  if (e instanceof UsageError) return EXIT.usage
  if (e instanceof AuthError) return EXIT.auth
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) return EXIT.auth
    if (e.status === 409 || e.status === 422) return EXIT.conflict
    if (e.status === 429) return EXIT.rate_limited
    if (e.status === 400 || e.status === 413) return EXIT.usage
  }
  return EXIT.other
}

/** What --json prints for an error: the API's own body when there is one, else the same shape. */
export function errorBody(e: unknown): Record<string, unknown> {
  if (e instanceof ApiError) return e.body
  if (e instanceof UsageError || e instanceof AuthError) return { error: e.code, message: e.message }
  if (e instanceof NetworkError) return { error: 'network_error', message: e.message }
  return { error: 'error', message: e instanceof Error ? e.message : String(e) }
}

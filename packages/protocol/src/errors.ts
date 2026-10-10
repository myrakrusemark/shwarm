// Error codes and their HTTP status (protocol §14, plus the four added in go-live step 2.1).
// Every error body is { error: <code>, message, ...details }.
// v0 (go-live 7.5; OPEN #96, the freeze is proposed): only codes something answers with. lobby_not_open went with the
// lobby and blocked_for_harm with the 403 create (a new node is 202 "held" and reads blocked), both Oct 9. The site adds
// not_found, gone and server_error (apps/site/src/web/errors.tsx), which have no ShwarmError.
export const ERRORS = {
  bad_request: 400,
  too_long: 400,
  unsupported_version: 400,
  bad_signature: 401,
  key_revoked: 401,
  not_your_name: 403,
  not_permitted: 403,
  bare_handle_needs_human: 403,
  dms_off: 403,
  not_established: 403,
  own_work: 403,
  no_such_node: 404,
  slot_taken: 409,
  not_a_submission: 409,
  shwarm_closed: 409,
  idempotency_conflict: 409,
  payload_too_large: 413,
  missing_evidence: 422,
  missing_repro: 422,
  hash_mismatch: 422,
  log_too_large: 422,
  bad_name: 422,
  bad_license: 422,
  no_done_test: 422,
  rate_limited: 429,
} as const

export type ErrorCode = keyof typeof ERRORS

export class ShwarmError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string = code.replace(/_/g, ' '),
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
  }
  get status(): number {
    return ERRORS[this.code]
  }
  toJSON() {
    return { error: this.code, message: this.message, ...this.details }
  }
}

export const isErrorCode = (s: string): s is ErrorCode => Object.hasOwn(ERRORS, s)

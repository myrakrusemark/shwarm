// Error codes and their HTTP status (protocol §14, plus the four added in go-live step 2.1).
// Every error body is { error: <code>, message, ...details }.
// v0 (go-live 7.5; #96, the freeze holds again from Oct 15): only codes something answers with. lobby_not_open went
// with the lobby and blocked_for_harm with the 403 create (a new node is 202 "held" and reads blocked), both Oct 9. The
// codes of submissions, checks, run reports and locks (not_established, slot_taken, not_a_submission, shwarm_closed,
// missing_evidence, missing_repro, hash_mismatch, log_too_large) left on Oct 15 ("Old API parts nothing uses are
// removed now"). The site adds not_found, gone and server_error (apps/site/src/web/errors.tsx), which have no
// ShwarmError.
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
  own_work: 403,
  not_joined: 403, // a branch's status: only people who joined it vote, claim or back (decided Oct 14)
  no_such_node: 404,
  idempotency_conflict: 409,
  payload_too_large: 413,
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

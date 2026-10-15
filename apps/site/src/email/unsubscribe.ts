// Unsubscribe links for the notices stream. The token names one person and one notice type and is
// HMAC-signed with MAIL_SECRET, so it checks without a database row: u1.<person id>.<type>.<issued, base36 seconds>.<mac>
import { toBase64url, utf8 } from '@shwarm/protocol'
import { w } from '../words'

// OPEN: how long an unsubscribe link keeps working. A year is generous (CAN-SPAM asks for at least 30 days).
export const UNSUB_TTL_MS = 365 * 86_400_000

export const NOTICE_TYPE = /^[a-z][a-z0-9_]{0,31}$/

async function mac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8('unsub:' + msg)))
  return toBase64url(sig.slice(0, 16))
}

export async function unsubToken(secret: string, personId: number, type: string, now = Date.now()): Promise<string> {
  if (!Number.isSafeInteger(personId) || personId < 1 || !NOTICE_TYPE.test(type)) throw new Error('bad unsubscribe target')
  const body = `u1.${personId}.${type}.${Math.floor(now / 1000).toString(36)}`
  return `${body}.${await mac(secret, body)}`
}

/** The person and notice type a token names, or null if it's forged, cut short or too old. */
export async function readUnsubToken(secret: string, token: unknown, now = Date.now()): Promise<{ personId: number; type: string } | null> {
  if (typeof token !== 'string' || token.length > 120) return null
  const m = /^u1\.([1-9][0-9]{0,15})\.([a-z][a-z0-9_]{0,31})\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{22})$/.exec(token)
  if (!m) return null
  const want = await mac(secret, `u1.${m[1]}.${m[2]}.${m[3]}`)
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ m[4].charCodeAt(i)
  if (diff !== 0) return null
  const issued = parseInt(m[3], 36) * 1000
  if (issued > now + 60_000 || now - issued > UNSUB_TTL_MS) return null
  return { personId: Number(m[1]), type: m[2] }
}

export const unsubUrl = (siteUrl: string, token: string) => `${siteUrl.replace(/\/$/, '')}/unsubscribe?t=${token}`

// OPEN (#85): "pass and fail" is new wording, waiting on Myra's yes.
const LABELS = (): Record<string, string> => ({ mention: w.email.noticeMention, pass_fail: w.email.noticePassFail })

/** "mention" → "mention", "lobby_filled" → "lobby filled", "pass_fail" → "pass and fail". */
export const noticeLabel = (type: string) => LABELS()[type] ?? type.replace(/_/g, ' ')

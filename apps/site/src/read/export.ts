// "download your data" (go-live 6.4, privacy page "your choices"): everything shwarm holds about one person, as one
// JSON file, for the signed-in owner only, behind the password step-up (web/profile.tsx). Their account and settings,
// sign-ins, keys, what they started, every post under their name (hidden ones too: it's their own text), their checks,
// upvotes, inbox, flags and reports, and the mail sent to them. Never a secret: no password hash, session or token ids,
// and no mail bodies (they hold sign-in links). Text only, like everything shwarm stores.
// OPEN (#86): what the file holds and its shape are builder's defaults; it isn't part of the API.

export const EXPORT_FORMAT = 'shwarm-export-1'
/** The most rows any one list holds. OPEN (#86): no cap is decided; an account past it is told the list was cut. */
export const EXPORT_ROWS = 20_000

type Rows = Record<string, unknown>[]

export async function readExport(db: D1Database, personId: number, now = Date.now()): Promise<Record<string, unknown> | null> {
  const account = await db
    .prepare(
      `SELECT handle, display_name, about, links, email, email_verified_at, status, founding, established_at, notice_prefs,
              terms_version, terms_accepted_at, age_confirmed_at, created_at, password_changed_at
       FROM person WHERE id = ?`,
    )
    .bind(personId)
    .first<Record<string, unknown>>()
  if (!account) return null
  const list = (sql: string) =>
    db
      .prepare(`${sql} LIMIT ${EXPORT_ROWS + 1}`)
      .bind(personId)
      .all<Record<string, unknown>>()
      .then(r => r.results)
  const [sessions, keys, nodes, pitches, seats, posts, postEdits, submissions, checks, upvotes, inbox, mail, flags, reports] = await Promise.all([
    list('SELECT created_at, last_seen_at, expires_at, ip_prefix, browser FROM session WHERE person_id = ?1 ORDER BY created_at'),
    list(
      `SELECT k.id, k.name, k.public_key, k.can_post_as, k.created_at, k.expires_at, k.revoked_at, k.last_used_at, k.last_used_as, k.last_used_node,
              (SELECT json_group_array(json_object('node', g.node, 'perms', json(g.perms))) FROM key_grant g WHERE g.key_id = k.id) AS grants,
              (SELECT json_group_array(json_object('ip_prefix', w.ip_prefix, 'first_seen', w.first_seen, 'last_seen', w.last_seen)) FROM key_network w WHERE w.key_id = k.id) AS networks
       FROM agent_key k WHERE k.person_id = ?1 ORDER BY k.created_at`,
    ),
    list(
      `SELECT n.path, n.kind, n.title, n.what, n.done_when, n.checks, n.lobby_size, n.license, n.builds_on, n.posted_by, n.state,
              n.triage, n.hidden, n.dead_end_note, n.created_at, n.live_at, n.closed_at,
              (SELECT json_group_array(t.tag) FROM node_tag t WHERE t.node_id = n.id) AS tags
       FROM node n WHERE n.author_id = ?1 ORDER BY n.created_at`,
    ),
    list('SELECT n.path, e.by_name, e.title, e.what, e.edited_at FROM node_edit e JOIN node n ON n.id = e.node_id WHERE n.author_id = ?1 ORDER BY e.edited_at'),
    list('SELECT n.path, s.number, s.joined_at, s.left_at FROM seat s JOIN node n ON n.id = s.node_id WHERE s.person_id = ?1 ORDER BY s.joined_at'),
    list(
      `SELECT p.id, n.path, p.as_name, p.key_id, p.kind, p.text, p.links, p.reply_to, p.hidden, p.created_at, p.edited_at, p.deleted_at
       FROM post p JOIN node n ON n.id = p.node_id WHERE p.person_id = ?1 ORDER BY p.created_at, p.id`,
    ),
    list('SELECT e.post_id AS post, e.text, e.links, e.edited_at FROM post_edit e JOIN post p ON p.id = e.post_id WHERE p.person_id = ?1 ORDER BY e.edited_at'),
    list(
      `SELECT s.post_id AS post, n.path, s.number, s.hash, s.how_to_check, s.status, s.author_swap, s.release_title, s.release_version,
              s.release_how_to_use, s.decided_at
       FROM submission s JOIN post p ON p.id = s.post_id JOIN node n ON n.id = s.node_id WHERE p.person_id = ?1 ORDER BY p.created_at`,
    ),
    list(
      `SELECT c.id, c.post_id AS post, c.submission_id AS submission, c.slot, c.verdict, c.evidence, c.repro, c.submission_hash, c.script_hash,
              c.exit_code, c.log_inline, c.log_link, c.machine, c.counted, c.reset_at, c.created_at
       FROM check_report c WHERE c.person_id = ?1 ORDER BY c.created_at`,
    ),
    list('SELECT post_id AS post, counted, created_at FROM upvote WHERE person_id = ?1 ORDER BY created_at'),
    list(
      `SELECT i.kind, n.path, i.post_id AS post, i.text, i.created_at, i.read_at, i.done_at
       FROM inbox_item i LEFT JOIN node n ON n.id = i.node_id WHERE i.person_id = ?1 ORDER BY i.created_at`,
    ),
    list('SELECT to_email, template, stream, created_at, sent_at, last_error FROM email_outbox WHERE person_id = ?1 ORDER BY created_at'),
    list('SELECT n.path, f.post_id AS post, f.reason, f.created_at, f.resolved_at FROM flag f LEFT JOIN node n ON n.id = f.node_id WHERE f.person_id = ?1 ORDER BY f.created_at'),
    list('SELECT n.path, r.post_id AS post, r.url, r.kind, r.text, r.created_at, r.resolved_at FROM report r LEFT JOIN node n ON n.id = r.node_id WHERE r.person_id = ?1 ORDER BY r.created_at'),
  ])
  // JSON columns come back as JSON, so the file reads as one document.
  const json = (rows: Rows, cols: string[]) =>
    rows.map(r => {
      const o = { ...r }
      for (const c of cols) {
        if (typeof o[c] !== 'string') continue
        try {
          o[c] = JSON.parse(o[c] as string)
        } catch {
          // kept as stored
        }
      }
      return o
    })
  const cut: string[] = []
  const lists: Record<string, Rows> = {
    sessions,
    keys: json(keys, ['grants', 'networks']),
    nodes: json(nodes, ['checks', 'builds_on', 'tags']),
    pitch_edits: pitches,
    seats,
    posts: json(posts, ['links']),
    post_edits: json(postEdits, ['links']),
    submissions,
    checks: json(checks, ['evidence', 'repro', 'log_link']),
    upvotes,
    inbox,
    mail,
    flags,
    reports,
  }
  for (const [k, v] of Object.entries(lists)) {
    if (v.length > EXPORT_ROWS) {
      v.length = EXPORT_ROWS
      cut.push(k)
    }
  }
  const [acct] = json([account], ['links', 'notice_prefs'])
  return { format: EXPORT_FORMAT, exported_at: new Date(now).toISOString(), account: acct, ...lists, ...(cut.length ? { cut_short: cut } : {}) }
}

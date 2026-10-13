// The site's words (go-live 11.8). Every word people see on the site lives in words/en/, one file per page area;
// pages read them as w.<area>.<entry>. Only English for now. A second language (open #116) will be a sibling folder
// with the same shape (`satisfies Words`), and `w` will then pick the request's language.
import { en } from './en'

export type Words = typeof en
export const w: Words = en

/** A short fingerprint of the whole word list. It's in every signed-out ETag (web/node-routes.tsx etagOf), so an
 * edited word reaches browsers and caches without a RENDER_VERSION bump. FNV-1a over the list as JSON. */
export const WORDS_VERSION = (() => {
  let h = 0x811c9dc5
  for (const ch of JSON.stringify(en)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return h.toString(36)
})()
export { count, fill, fillx, type Plural } from './fill'

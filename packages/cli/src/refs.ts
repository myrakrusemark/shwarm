// Node references as people paste them: a path (minecraft-in-doom/block-placement), /w/<path>, or a node URL, each
// optionally with /s/<n> for a submission and a #post fragment. Paths keep their literal slashes (prd-api LIB-6).
import { UsageError } from './errors'

const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** Segments that name a view of a node, never a node (protocol §3). */
const VIEWS = new Set(['branches', 'log', 's'])

export type NodeRef = {
  /** The site the reference named, when it was a URL. */
  origin: string | null
  path: string
  /** A submission number, from /s/<n>. */
  submission: number | null
  /** A post id, from #p_… */
  post: string | null
}

export function parseRef(input: string): NodeRef {
  let s = input.trim()
  let origin: string | null = null
  let post: string | null = null
  if (/^https?:\/\//i.test(s)) {
    let u: URL
    try {
      u = new URL(s)
    } catch {
      throw new UsageError(`${input} is not a node url`)
    }
    if (!u.pathname.startsWith('/w/')) throw new UsageError(`${input} is not a node url: node urls start with /w/`)
    origin = u.origin
    post = u.hash.length > 1 ? decodeURIComponent(u.hash.slice(1)) : null
    s = u.pathname.slice(3)
  } else {
    const hash = s.indexOf('#')
    if (hash !== -1) {
      post = s.slice(hash + 1) || null
      s = s.slice(0, hash)
    }
    s = s.replace(/^\/?w\//, '').replace(/^\//, '')
  }
  const parts = s.replace(/\/+$/, '').split('/')
  const i = parts.findIndex(p => VIEWS.has(p))
  const nodeParts = i === -1 ? parts : parts.slice(0, i)
  if (!nodeParts.length || !nodeParts.every(p => SEGMENT.test(p))) throw new UsageError(`${input} is not a node path`)
  let submission: number | null = null
  if (i !== -1) {
    const view = parts.slice(i)
    if (view[0] !== 's' || view.length !== 2 || !/^[1-9][0-9]{0,8}$/.test(view[1])) throw new UsageError(`${input} is not a node path`)
    submission = Number(view[1])
  }
  return { origin, path: nodeParts.join('/'), submission, post }
}

/** /w/<path> with each segment encoded and the slashes kept. */
export const nodeUrlPath = (path: string, ...rest: string[]) =>
  '/w/' + [...path.split('/'), ...rest].map(encodeURIComponent).join('/')

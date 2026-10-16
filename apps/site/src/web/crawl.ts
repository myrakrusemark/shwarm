// What search engines and link unfurlers are told (go-live 11.7): /robots.txt and /sitemap.xml. The per-page link
// previews and canonical links are in the layout (web/layout.tsx, `canonical` and `card`).
//
// robots.txt: production keeps crawlers off the account, key, message and admin pages and the forms, and points at the
// sitemap; everywhere else (staging, local, tests) it disallows everything. It is served before the staging lock
// (src/index.ts): a crawler that gets a 401 for robots.txt reads that as "crawl anything". Until the site opens, every
// response also carries X-Robots-Tag: noindex (src/index.ts), so production's rules only matter from the opening on.
//
// sitemap.xml: home, the footer pages and guides, the triage page (go-live 9.2), and every shwarm and branch the public can read (read/visibility.ts
// PUBLIC_NODE: not taken down, cleared by triage or seeded, and so is everything above it). A closed shwarm's address
// is its result page, so it is listed once. Where the reading pages are closed (production in holding mode) it lists
// only home, the footer pages and the triage page. A public read like the feed: the same per-network read limit, cached 15 minutes.
import type { Context } from 'hono'
import { readingOpen, stagingOpenReads } from '../core/site-mode'
import { PUBLIC_NODE } from '../read/visibility'
import { PAGES } from './doc'
import { overReadCap } from './read-limit'
import { siteOrigin } from './viewer'

/** The most shwarms and branches one sitemap lists, the most recently changed first. OPEN: a first guess; the format allows 50,000. */
export const SITEMAP_MAX = 5000

/** Where crawlers stay out on production: account, keys, messages, admin, the forms, the hooks. */
// The paths are prefixes: /verify covers /verified, /keys covers /keys/nodes.
export const ROBOTS_DISALLOW = [
  '/admin',
  '/keys',
  '/dms',
  '/step-up',
  '/join',
  '/signin',
  '/signout',
  '/check-email',
  '/verify',
  '/forgot',
  '/reset',
  '/email-change',
  '/new',
  '/report',
  '/donate',
  '/terms/accept',
  '/unsubscribe',
  '/hooks/',
] as const

type Env = { Bindings: { DB: D1Database; ENV?: string; SITE_MODE?: string; SITE_URL?: string; STAGING_OPEN_READS?: string } }

/**
 * What staging lets anyone read without its password when STAGING_OPEN_READS is set (the agent guide's trial, Oct 15):
 * home and the front door, the guide, the shwarm list and search, shwarm and branch pages, the skill and its files, and
 * the footer pages and guides (already public on production). The lock in src/index.ts lets GET and HEAD of these
 * through, and robots.txt allows them. Forms, accounts, keys, messages and admin stay locked.
 */
export const STAGING_OPEN_EXACT = ['/', '/guide', '/llms.txt', '/shwarms', '/skills'] as const
export const STAGING_OPEN_PREFIX = ['/w/', '/skills/'] as const
export const stagingOpenPath = (path: string) =>
  (STAGING_OPEN_EXACT as readonly string[]).includes(path) || STAGING_OPEN_PREFIX.some(p => path.startsWith(p)) || PAGES.some(p => path === `/${p.slug}`)

export function robotsTxt(env: { ENV?: string; STAGING_OPEN_READS?: string }, origin: string): string {
  // Staging with open reads: the open paths, as prefixes so a query string still matches (home is `/$` and `/?`, since
  // `$` ends a path). A prefix that also covers a locked path (/terms covers /terms/accept) only meets the lock's 401.
  // X-Robots-Tag: noindex still keeps every page out of search results.
  if (stagingOpenReads(env)) {
    const allow = ['/$', '/?', ...STAGING_OPEN_EXACT.filter(p => p !== '/'), ...STAGING_OPEN_PREFIX, ...PAGES.map(p => `/${p.slug}`)]
    return ['User-agent: *', ...allow.map(p => `Allow: ${p}`), 'Disallow: /', ''].join('\n')
  }
  if (env.ENV !== 'production') return 'User-agent: *\nDisallow: /\n'
  return ['User-agent: *', 'Allow: /w/', ...ROBOTS_DISALLOW.map(p => `Disallow: ${p}`), '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n')
}

export function robots(c: Context<Env>): Response {
  c.header('Cache-Control', 'public, max-age=3600')
  return c.text(robotsTxt(c.env, siteOrigin(c)))
}

const xmlEscape = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)

/** The listed nodes: path and last change, newest first. */
export async function sitemapNodes(db: D1Database, max = SITEMAP_MAX): Promise<{ path: string; at: string }[]> {
  const { results } = await db
    .prepare(`SELECT n.path, coalesce(n.changed_at, n.created_at) AS at FROM node n WHERE ${PUBLIC_NODE('n')} ORDER BY at DESC, n.id DESC LIMIT ?`)
    .bind(max)
    .all<{ path: string; at: string }>()
  return results
}

export function sitemapXml(origin: string, nodes: { path: string; at: string }[]): string {
  const url = (path: string, at?: string) => `<url><loc>${xmlEscape(origin + path)}</loc>${at ? `<lastmod>${xmlEscape(at)}</lastmod>` : ''}</url>`
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url('/'),
    ...PAGES.map(p => url(`/${p.slug}`)),
    url('/triage'),
    ...nodes.map(n => url(`/w/${n.path.split('/').map(encodeURIComponent).join('/')}`, n.at)),
    '</urlset>',
    '',
  ].join('\n')
}

export async function sitemap(c: Context<Env>): Promise<Response> {
  const capped = overReadCap(c, 'text')
  if (capped) return capped
  const nodes = readingOpen(c.env) ? await sitemapNodes(c.env.DB) : []
  c.header('Cache-Control', 'public, s-maxage=900')
  return c.body(sitemapXml(siteOrigin(c), nodes), 200, { 'Content-Type': 'application/xml; charset=utf-8' })
}

import type { FC } from 'hono/jsx'
import { NEEDS_HUMANS } from '../core/tags'
import { tagHref } from '../render/text'
import { w } from '../words'

// A shwarm's tags as links to the feed filtered by each (/?tag=), on the feed's cards and the shwarm's page. Tags are
// checked against core/nodes.ts TAG_RE when posted (lowercase letters, digits, dashes), so they print as they are.
// #needs-humans comes first (the readers put it there: core/tags.ts humansFirst) in its own style, class "nh" (decided
// Oct 15, Myra: "if a shwarm needs humans, it shows first, and is emphasized").

export const TagLink: FC<{ tag: string }> = ({ tag }) =>
  tag === NEEDS_HUMANS ? (
    <a class="t nh" href={tagHref(tag)} title={w.chrome.needsHumansTitle}>#{tag}</a>
  ) : (
    <a class="t" href={tagHref(tag)}>#{tag}</a>
  )

// "✓ author approved" (decided Oct 15, "The author's own approval shows beside the status"): a shwarm's author's own
// approval of its pass, shown beside the status badge on its page head and its feed card, never as part of the badge.
// The badge stays its people's status, so the mark shows whatever that status is now ("the two are not the same").
// Its hover text names when and the claim the author cited. A title doesn't show on a phone, so the mark is also a
// link to the pass box (#passed), where the author's record says the same in full. Styled in common.css (.approved).
import type { FC } from 'hono/jsx'
import { FORMER } from '../read/names'
import { PASS_BOX, type AuthorApproved } from '../read/status'
import { monthDay } from '../render/format'
import { fill, w } from '../words'

/** The mark's hover text: "the author approved on oct 15 09:12, citing @ana's claim", the date as the pass box shows it. */
export const approvedTitle = (a: AuthorApproved): string => {
  const date = monthDay(a.at, true)
  return a.claim ? fill(w.node.authorApprovedTitle, { date, name: a.claim.by || FORMER }) : fill(w.node.authorApprovedOn, { date })
}

/** The mark itself, linked to the node's pass box at `href` (its page's address). */
export const ApprovedMark: FC<{ a: AuthorApproved; href: string }> = ({ a, href }) => (
  <a class="approved" href={`${href}#${PASS_BOX}`} title={approvedTitle(a)}>
    {w.node.authorApproved}
  </a>
)

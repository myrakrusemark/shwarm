// #needs-humans, kept and set apart (decided Oct 15, Myra: "if a shwarm needs humans, it shows first, and is
// emphasized"). It marks a shwarm agents can't finish alone. Wherever a shwarm's tags are read for showing (the feed
// card, the shwarm's page, the text and JSON answers) it comes first; the pages give it its own style (class "nh"), and
// the trending row (read/trending.ts) pins it first whatever its count. Stored tags keep the author's order. The feed
// doesn't move these shwarms up: its order is unchanged (Myra, Oct 15: "its enough that theyre emphasized.").

export const NEEDS_HUMANS = 'needs-humans'

/** The tags in the author's order, with #needs-humans moved to the front when the shwarm has it. */
export const humansFirst = (tags: string[]): string[] => (tags.includes(NEEDS_HUMANS) ? [NEEDS_HUMANS, ...tags.filter(t => t !== NEEDS_HUMANS)] : tags)

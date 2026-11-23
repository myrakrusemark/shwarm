/**
 * The one switch for the activity numbers people see on the site: upvote counts (the feed's count column, the box at
 * the top of a shwarm or branch page, the number on a post's ▲), the "upvotes" sort, and a "0 posts/day".
 *
 * Off since Nov 22, 2026 (Myra: "let's hide upvotes altogether for now until some of them can show real values. When
 * we're ready we'll unhide all these zeros."): a launch-week feed was a column of zeros and read as a dead site.
 * Upvoting itself still works, and the numbers are still counted and still in what agents read.
 *
 * Set `show` to true to show them all again, exactly as before. (An object, not a bare const, so tests can check both
 * ways; nothing else should write to it.)
 */
export const activityNumbers = { show: false }

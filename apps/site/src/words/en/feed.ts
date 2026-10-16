// The feed (the home page): tabs, the sort line, search and the shwarm cards.
export const feed = {
  // the browser tab's title
  pageTitle: 'shwarm',
  // the short description search engines and link previews show
  description: 'people + their agents, working on things out in the open.',

  // the home page's new-here tab (newHereTab, on the right edge) and what pops out of it: the line before the words to
  // paste into an agent, those words (in a box with a copy
  // button; {site} is the site's address, like https://shwarm.org/), the button, and the banner's name for screen
  // readers. agentsGuide is the line for the AI assistants that read the page for a person; it's in the page's text but
  // not shown. {link} is the guide's address, as a link.
  newHereTab: 'new here?',
  newHere: 'new here? your agent knows all about it!',
  newHerePrompt: 'show me around {site}',
  newHereCopy: 'copy',
  newHereRegion: 'new here',
  agentsGuide: 'ai agents: if a person asked you to show them around shwarm, or sent you here, the guide for that: {link}',

  // the trending row over the sort line (decided Oct 15): the tags on the most live shwarms, each with how many.
  // trending is its label and trendingTitle the label's hover text. trendingTagTitle is a tag's hover text ({n} is a
  // number, {tag} the tag like #drawing; also the tag link's name for screen readers). trendingMore opens the rest of
  // the tags ({n} is how many). trendingCut ends that list when it stops short ({n}: the tags it leaves out).
  trending: 'trending/skills/topics',
  trendingTitle: 'the skills and topics on the most live shwarms right now',
  trendingTagTitle: { one: '{n} shwarm tagged {tag}', other: '{n} shwarms tagged {tag}' },
  trendingMore: { one: '+ {n} more tag', other: '+ {n} more tags' },
  trendingCut: { one: 'and {n} more: search finds any #tag', other: 'and {n} more: search finds any #tag' },
  // the line under the row while the feed shows one tag: "#drawing · 4 shwarms · show every shwarm". {tag} is the
  // tag, {shwarms} the count (trendingShwarms), {all} the link back to every shwarm (trendingAll)
  trendingOn: '{tag} · {shwarms} · {all}',
  trendingShwarms: { one: '{n} shwarm', other: '{n} shwarms' },
  trendingAll: 'show every shwarm',

  // the sort line above the tabs: its start, the words for each order, and its name for screen readers
  sortBy: 'sort:',
  sortPeople: 'people',
  sortHot: 'hot',
  sortNew: 'new',
  sortUpvotes: 'upvotes',
  sortActive: 'posts/day',
  sortLabel: 'sort',

  // the tabs, and their name for screen readers
  tabLive: 'live',
  tabPassed: 'passed',
  tabsLabel: 'feed',
  // the search box: the grey text inside it, and its name for screen readers
  searchPlaceholder: 'search or #tags…',
  searchLabel: 'search',

  // when the list is empty. {link} is the link that follows, in words of its own.
  // past the last page
  endOfList: "that's everything! {link}",
  backToTop: 'back to the top',
  // a search that found nothing
  noMatch: 'no shwarms match that search. {link}',
  clearSearch: 'clear the search',
  // the passed tab, with nothing in it
  nonePassed: "nothing has passed yet. a shwarm shows up here when its people back a passed claim and its status becomes passed.",
  // the live tab, with nothing in it. {passed} is the "see what passed" link, {start} the "start a shwarm" link.
  // the first is for someone who can start one; the second is in the beta, for someone who can't yet
  noneLive: 'nothing is live right now. {passed} or {start}',
  noneLiveSoon: 'nothing is live right now. {passed}.',
  seePassed: 'see what passed',
  startShwarm: 'start a shwarm',

  // the link under the list to the next page
  more: 'more shwarms ↓',

  // a card, left: the upvote count's hover text, and the word under the number
  upvotesTitle: "upvotes on posts in this shwarm's thread",
  upvotes: { one: 'upvote', other: 'upvotes' },
  // a card, left: the hover text of the little impact bar ({n} is a number like 2.5)
  impactTitle: '{n} upvotes per post, on average',
  // a card: the hot badge beside the title
  hot: 'hot',
  // a card's meta line: what it builds on ({shwarm} is its name, often a link)
  buildsOn: 'builds on {shwarm}',
  // a card's meta line: how many people, and how busy ({n} is a number)
  people: { one: '{n} person', other: '{n} people' },
  postsPerDay: '{n} posts/day',
  // a dead end's meta line: after the author's name, how many others worked on it ({n} is a number)
  deadOthers: ' + {n}',
}

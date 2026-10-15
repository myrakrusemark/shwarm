// The feed (the home page): tabs, the sort line, search and the shwarm cards.
export const feed = {
  // the browser tab's title
  pageTitle: 'shwarm',
  // the short description search engines and link previews show
  description: 'people + their agents, working on things out in the open.',

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

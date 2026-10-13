// The feed (the home page): tabs, the sort line, search and the shwarm cards.
export const feed = {
  // the browser tab's title
  pageTitle: 'shwarm',
  // the short description search engines and link previews show
  description: 'people + their agents, working on things in the open.',

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
  tabClosed: 'closed',
  tabsLabel: 'feed',
  // the search box: the grey text inside it, and its name for screen readers
  searchPlaceholder: 'search or #tags…',
  searchLabel: 'search',

  // when the list is empty. {link} is the link that follows, in words of its own.
  // past the last page
  endOfList: "that's all of them. {link}",
  backToTop: 'back to the top',
  // a search that found nothing
  noMatch: 'no shwarms match that search. {link}',
  clearSearch: 'clear the search',
  // the closed tab, with nothing in it
  noneClosed: 'nothing has closed yet. a shwarm shows up here when its done test passes, or when its author calls it a dead end.',
  // the live tab, with nothing in it. {closed} is the "see what closed" link, {start} the "start a shwarm" link.
  // the first is for someone who can start one; the second is in the beta, for someone who can't yet
  noneLive: 'nothing is live right now. {closed} or {start}',
  noneLiveSoon: 'nothing is live right now. {closed}.',
  seeClosed: 'see what closed',
  startShwarm: 'start a shwarm',

  // the link under the list to the next page
  more: 'more ↓',

  // a card, left: the upvote count's hover text, and the word under the number
  upvotesTitle: 'upvotes on posts in this thread',
  upvotes: { one: 'upvote', other: 'upvotes' },
  // a card, left: the hover text of the little impact bar ({n} is a number like 2.5)
  impactTitle: '▲{n} per post',
  // a card: the hot badge beside the title, and its hover text ({times} is a number like 3.2)
  hot: 'hot',
  hotTitle: 'thread upvotes today are {times}× its 7-day average',
  hotTitleNoNumber: 'thread upvotes today are well above its 7-day average',
  // a card: the line under the title. {test} is the shwarm's done test.
  doneWhen: 'Done when: {test}',
  // a card's meta line: what it builds on ({shwarm} is its name, often a link)
  buildsOn: 'builds on {shwarm}',
  // a card's meta line: how many people, and how busy ({n} is a number)
  people: { one: '{n} person', other: '{n} people' },
  postsPerDay: '{n} posts/day',
  // a dead end's meta line: after the author's name, how many others worked on it ({n} is a number)
  deadOthers: ' + {n}',
  // a card, right: its state
  live: 'live',
  closed: 'closed',
  deadEnd: 'dead end',
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SmallGroupPlaylistAggregator,
  parseShowsPage,
  findOwnSiteLink,
  findFeedLinks,
  looksLikePodcastFeed,
  extractChannelGuid,
  extractChannelMedium,
  parseFeedEpisodes,
  feedGuidFromUrl,
  mergeEpisodes,
  buildPlaylistXml
} from './SmallGroupPlaylistAggregator.js';
import { sameApartFromBuildDates } from '../utils/xml.js';

// Trimmed copy of the real https://smallgroupscoop.com/shows/ markup: each show
// is linked from the nav, a hidden card link, and the card heading.
const SHOWS_PAGE = `
<nav><a href="/">Scoop</a> <a href="/shows/">Shows</a> <a href="/board/">Board</a></nav>
<ul>
  <li><a href="/shows/abs-n-a-6-pack/">ABS n&#x27; a 6-Pack</a></li>
  <li><a href="/shows/mutton-mead-music/">Mutton, Mead &amp; Music</a></li>
</ul>
<main>
  <a href="/shows/abs-n-a-6-pack/" aria-hidden="true" tabindex="-1">ABS n&#x27; a 6-Pack</a>
  <h2><a href="/shows/abs-n-a-6-pack/">ABS n&#x27; a 6-Pack</a></h2>
  <a href="https://smallgroupscoop.com/shows/mutton-mead-music/" aria-hidden="true">Mutton, Mead &amp; Music</a>
  <h2><a href="https://smallgroupscoop.com/shows/mutton-mead-music/"><span>Mutton, Mead &amp; Music</span></a></h2>
  <h2><a href="/shows/brand-new-show/">Brand New Show</a></h2>
</main>`;

test('parseShowsPage returns each show once, in page order, with decoded names', () => {
  assert.deepEqual(parseShowsPage(SHOWS_PAGE), [
    { slug: 'abs-n-a-6-pack', name: "ABS n' a 6-Pack" },
    { slug: 'mutton-mead-music', name: 'Mutton, Mead & Music' },
    { slug: 'brand-new-show', name: 'Brand New Show' }
  ]);
});

test('parseShowsPage ignores the /shows/ index link and episode sub-pages', () => {
  const html = `<a href="/shows/">Shows</a><a href="/shows/bowl-after-bowl/episodes/464/">Ep 464</a>`;
  assert.deepEqual(parseShowsPage(html), []);
});

test('findOwnSiteLink returns the external "own site" link on a show page', () => {
  const html = `
    <a href="/shows/">Shows</a>
    <p><a href="https://bowlafterbowl.com">Visit the show's own site &rarr;</a></p>
    <a href="https://bowlafterbowl.com/episodes/episode-464/">Episode 464</a>`;
  assert.equal(findOwnSiteLink(html), 'https://bowlafterbowl.com');
});

test('findOwnSiteLink returns null when the page has no own-site link', () => {
  assert.equal(findOwnSiteLink('<a href="https://bowlafterbowl.com/episodes/1/">Ep 1</a>'), null);
});

test('findFeedLinks returns RSS/Atom alternate links resolved against the page URL', () => {
  const html = `<head>
    <link rel="stylesheet" href="/style.css">
    <link rel="alternate" type="application/rss+xml" title="Podcast" href="/podcast?format=rss&amp;x=1">
    <link href="https://feeds.example.com/atom.xml" type="application/atom+xml" rel="alternate">
    <link rel="alternate" type="text/html" href="/other">
  </head>`;
  assert.deepEqual(findFeedLinks(html, 'https://www.absna6pack.com/'), [
    'https://www.absna6pack.com/podcast?format=rss&x=1',
    'https://feeds.example.com/atom.xml'
  ]);
});

test('looksLikePodcastFeed accepts a feed whose items carry audio enclosures', () => {
  const xml = `<rss><channel><item><title>Ep</title>
    <enclosure url="https://x.com/ep.mp3" length="1" type="audio/mpeg"/></item></channel></rss>`;
  assert.equal(looksLikePodcastFeed(xml), true);
});

test('looksLikePodcastFeed rejects a blog feed with no media enclosures', () => {
  const xml = `<rss><channel><item><title>Post</title><link>https://x.com/post</link>
    <enclosure url="https://x.com/photo.jpg" type="image/jpeg"/></item></channel></rss>`;
  assert.equal(looksLikePodcastFeed(xml), false);
});

test('looksLikePodcastFeed ignores enclosures that only appear in liveItems', () => {
  const xml = `<rss><channel>
    <podcast:liveItem status="pending"><enclosure url="https://x.com/live.mp3" type="audio/mpeg"/></podcast:liveItem>
    <item><title>Post</title></item></channel></rss>`;
  assert.equal(looksLikePodcastFeed(xml), false);
});

// Feed channel headers in the wild declare the podcast namespace under either
// URI; ABS n' a 6-Pack (Squarespace) has no podcast namespace at all.
const NEW_NS = 'xmlns:podcast="https://podcastindex.org/namespace/1.0"';
const OLD_NS = 'xmlns:podcast="https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md"';

test('extractChannelGuid reads the channel guid under either namespace URI', () => {
  for (const ns of [NEW_NS, OLD_NS]) {
    const xml = `<rss ${ns}><channel><title>Bowl After Bowl</title>
      <podcast:guid> 2d418249-453a-5714-8abc-5b657570b641 </podcast:guid>
      <item><guid>ep-1</guid></item></channel></rss>`;
    assert.equal(extractChannelGuid(xml), '2d418249-453a-5714-8abc-5b657570b641');
  }
});

test('extractChannelGuid ignores guids inside items and liveItems', () => {
  const xml = `<rss><channel><title>No channel guid</title>
    <podcast:liveItem status="live"><podcast:guid>live-guid</podcast:guid></podcast:liveItem>
    <item><podcast:guid>item-guid</podcast:guid></item></channel></rss>`;
  assert.equal(extractChannelGuid(xml), null);
});

test('extractChannelGuid finds a channel guid that comes after a liveItem (Podhome feeds)', () => {
  const xml = `<rss ${NEW_NS}><channel><title>Chad and Reeds</title>
    <podcast:liveItem status="pending" start="2026-10-29T00:30:00.000Z"><guid>live-1</guid>
      <podcast:guid>live-guid</podcast:guid></podcast:liveItem>
    <podcast:guid>7c6f7875-2b73-491e-b32c-e2c8d6e91d53</podcast:guid>
    <item><podcast:guid>item-guid</podcast:guid></item></channel></rss>`;
  assert.equal(extractChannelGuid(xml), '7c6f7875-2b73-491e-b32c-e2c8d6e91d53');
});

test('extractChannelMedium reads the channel medium, or null when absent', () => {
  assert.equal(extractChannelMedium(`<channel><podcast:medium>video</podcast:medium><item/></channel>`), 'video');
  assert.equal(extractChannelMedium(`<channel><title>x</title><item><podcast:medium>music</podcast:medium></item></channel>`), null);
});

function feedXml(itemsXml) {
  return `<?xml version="1.0"?><rss version="2.0" ${NEW_NS}><channel>
    <title>Show</title><podcast:guid>feed-guid</podcast:guid><podcast:medium>podcast</podcast:medium>
    ${itemsXml}</channel></rss>`;
}

function itemXml(guid, pubDate) {
  return `<item><title>${guid}</title><guid isPermaLink="false">${guid}</guid><pubDate>${pubDate}</pubDate>
    <enclosure url="https://x.com/${guid}.mp3" length="1" type="audio/mpeg"/></item>`;
}

test('parseFeedEpisodes returns the newest episodes first, capped at the limit', async () => {
  const xml = feedXml([
    itemXml('ep-1', 'Mon, 01 Sep 2026 10:00:00 GMT'),
    itemXml('ep-3', 'Wed, 03 Sep 2026 10:00:00 GMT'),
    itemXml('ep-2', 'Tue, 02 Sep 2026 10:00:00 GMT')
  ].join(''));
  const result = await parseFeedEpisodes(xml, 2);
  assert.equal(result.feedGuid, 'feed-guid');
  assert.equal(result.medium, 'podcast');
  assert.deepEqual(result.episodes, [
    { itemGuid: 'ep-3', pubDate: '2026-09-03T10:00:00.000Z' },
    { itemGuid: 'ep-2', pubDate: '2026-09-02T10:00:00.000Z' }
  ]);
});

test('parseFeedEpisodes skips liveItems and items without a guid', async () => {
  const xml = feedXml(`
    <podcast:liveItem status="pending" start="2026-12-01T10:00:00Z"><title>Live</title>
      <guid>live-1</guid><enclosure url="https://x.com/live.mp3" type="audio/mpeg"/></podcast:liveItem>
    <item><title>No guid</title><pubDate>Fri, 05 Sep 2026 10:00:00 GMT</pubDate></item>
    ${itemXml('ep-1', 'Mon, 01 Sep 2026 10:00:00 GMT')}`);
  const result = await parseFeedEpisodes(xml, 10);
  assert.deepEqual(result.episodes.map((e) => e.itemGuid), ['ep-1']);
});

test('parseFeedEpisodes reads CDATA guids and keeps undated episodes last', async () => {
  const xml = feedXml(`
    <item><title>Undated</title><guid><![CDATA[ https://show.example/?p=1&x=2 ]]></guid></item>
    ${itemXml('ep-1', 'Mon, 01 Sep 2026 10:00:00 GMT')}`);
  const result = await parseFeedEpisodes(xml, 10);
  assert.deepEqual(result.episodes, [
    { itemGuid: 'ep-1', pubDate: '2026-09-01T10:00:00.000Z' },
    { itemGuid: 'https://show.example/?p=1&x=2', pubDate: null }
  ]);
});

test('feedGuidFromUrl matches the Podcast Index guid for a scheme-less feed URL', () => {
  // Bowl After Bowl's published <podcast:guid>, derived by Podcast Index.
  assert.equal(feedGuidFromUrl('https://feed.bowlafterbowl.com/feed.xml'), '2d418249-453a-5714-8abc-5b657570b641');
  assert.equal(feedGuidFromUrl('http://feed.bowlafterbowl.com/feed.xml/'), '2d418249-453a-5714-8abc-5b657570b641');
});

function episode(slug, itemGuid, pubDate, extra = {}) {
  return { slug, feedGuid: `${slug}-guid`, feedUrl: `https://${slug}.example/feed.xml`, itemGuid, pubDate, ...extra };
}

test('mergeEpisodes interleaves shows newest-first by release date', () => {
  const bySlug = new Map([
    ['bab', [episode('bab', 'bab-2', '2026-10-21T00:00:00.000Z'), episode('bab', 'bab-1', '2026-10-01T00:00:00.000Z')]],
    ['hgh', [episode('hgh', 'hgh-1', '2026-10-15T00:00:00.000Z')]]
  ]);
  assert.deepEqual(mergeEpisodes(bySlug, ['bab', 'hgh']).map((e) => e.itemGuid), ['bab-2', 'hgh-1', 'bab-1']);
});

test('mergeEpisodes breaks date ties by page order and puts undated episodes last', () => {
  const same = '2026-10-10T00:00:00.000Z';
  const bySlug = new Map([
    ['hgh', [episode('hgh', 'hgh-undated', null), episode('hgh', 'hgh-1', same)]],
    ['bab', [episode('bab', 'bab-1', same)]]
  ]);
  assert.deepEqual(mergeEpisodes(bySlug, ['bab', 'hgh']).map((e) => e.itemGuid), ['bab-1', 'hgh-1', 'hgh-undated']);
});

test('mergeEpisodes drops shows that are no longer in the show order', () => {
  const bySlug = new Map([
    ['bab', [episode('bab', 'bab-1', '2026-10-01T00:00:00.000Z')]],
    ['gone', [episode('gone', 'gone-1', '2026-10-20T00:00:00.000Z')]]
  ]);
  assert.deepEqual(mergeEpisodes(bySlug, ['bab']).map((e) => e.itemGuid), ['bab-1']);
});

test('sameApartFromBuildDates ignores only the two build dates', () => {
  const a = [episode('bab', 'bab-1', '2026-10-01T00:00:00.000Z')];
  const build = (items, opts = {}) => buildPlaylistXml(items, { pubDate: 'Thu, 22 Oct 2026 12:00:00 GMT', ...opts });
  const same = sameApartFromBuildDates;
  assert.equal(same(build(a), build(a, { pubDate: 'Fri, 23 Oct 2026 12:00:00 GMT' })), true, 'a new run date is not a change');
  assert.equal(same(build(a), build([episode('bab', 'bab-1', '2026-10-02T00:00:00.000Z')])), true, 'episode dates are not in the XML');
  assert.equal(same(build(a), build([episode('bab', 'bab-2', '2026-10-01T00:00:00.000Z')])), false);
  assert.equal(same(build(a), build([{ ...a[0], feedUrl: 'https://moved.example/feed.xml' }])), false);
  assert.equal(same(build(a), build([{ ...a[0], medium: 'video' }])), false);
  assert.equal(same(build(a), build([...a, ...a])), false);
  assert.equal(same(build(a), build(a, { imageUrl: 'https://x.example/art.webp' })), false, 'new cover art is a change');
});

test('buildPlaylistXml writes one escaped podcastL remoteItem per episode, in order', () => {
  const xml = buildPlaylistXml([
    episode('bab', 'https://bab.example/?p=1&x=2', '2026-10-21T00:00:00.000Z', { medium: 'podcast' }),
    episode('hso', 'hso-1', '2025-07-10T00:00:00.000Z', { medium: 'video' }),
    episode('abs', 'abs-1', null)
  ]);
  assert.match(xml, /<podcast:medium>podcastL<\/podcast:medium>/);
  assert.match(xml, /<podcast:guid>[0-9a-f-]{36}<\/podcast:guid>/);
  // A web page is not a source feed; the daily RSS loop would try to parse it.
  assert.doesNotMatch(xml, /purpose="source-feed"/);
  assert.deepEqual(xml.split('\n').filter((line) => line.includes('remoteItem')), [
    '    <podcast:remoteItem feedGuid="bab-guid" feedUrl="https://bab.example/feed.xml" itemGuid="https://bab.example/?p=1&amp;x=2"/>',
    '    <podcast:remoteItem feedGuid="hso-guid" feedUrl="https://hso.example/feed.xml" itemGuid="hso-1" medium="video"/>',
    '    <podcast:remoteItem feedGuid="abs-guid" feedUrl="https://abs.example/feed.xml" itemGuid="abs-1"/>'
  ]);
});

test('buildPlaylistXml only includes artwork when an image URL is given', () => {
  const items = [episode('bab', 'bab-1', null)];
  assert.doesNotMatch(buildPlaylistXml(items), /<image>/);
  assert.match(
    buildPlaylistXml(items, { imageUrl: 'https://x.example/art.webp' }),
    /<image>\s*<url>https:\/\/x\.example\/art\.webp<\/url>\s*<\/image>/
  );
});

test('buildPlaylistXml keeps the same playlist guid across builds', () => {
  const guid = (xml) => xml.match(/<podcast:guid>([^<]+)</)[1];
  assert.equal(guid(buildPlaylistXml([episode('a', '1', null)])), guid(buildPlaylistXml([episode('b', '2', null)])));
});

// --- generate(): the whole run, against an in-memory web and target repo ---

const SHOWS_URL = 'https://smallgroupscoop.com/shows/';
const BAB_FEED = 'https://feed.bowlafterbowl.com/feed.xml';
const HGH_FEED = 'https://feed.homegrownhits.xyz/feed.xml';
const ABS_FEED = 'https://www.absna6pack.com/?format=rss';
const PLAYLIST_PATH = 'docs/smallgroup-shows-playlist.xml';
const STATE_PATH = 'state/smallgroup-shows-playlist.json';

function showsPage(shows) {
  return shows.map(([slug, name]) => `<h2><a href="/shows/${slug}/">${name}</a></h2>`).join('\n');
}

function showFeed(guid, items, medium = 'podcast') {
  return `<?xml version="1.0"?><rss version="2.0" ${OLD_NS}><channel><title>Show</title>
    ${guid ? `<podcast:guid>${guid}</podcast:guid>` : ''}<podcast:medium>${medium}</podcast:medium>
    ${items.map(([itemGuid, date]) => itemXml(itemGuid, date)).join('')}</channel></rss>`;
}

// URL -> response body (string) or Error to throw; anything else is a 404.
function fakeWeb(pages) {
  const requested = [];
  const fetchText = async (url) => {
    requested.push(url);
    const page = pages[url];
    if (page instanceof Error) throw page;
    if (page === undefined) throw new Error('Request failed with status code 404');
    return page;
  };
  return { fetchText, requested };
}

// Stands in for GitHubSync: same getFileContent/updateFile contract, in memory.
function fakeRepo(files = {}) {
  const contents = new Map(Object.entries(files));
  const commits = [];
  return {
    contents,
    commits,
    async getFileContent(path) {
      return contents.has(path) ? contents.get(path) : null;
    },
    async updateFile(path, content, message) {
      contents.set(path, content);
      commits.push({ path, message });
      return { success: true };
    }
  };
}

function aggregator(web, repo) {
  const playlistsDir = mkdtempSync(join(tmpdir(), 'smallgroup-test-'));
  return new SmallGroupPlaylistAggregator(
    { playlistsDir, enableGitHubSync: true },
    { fetchText: web.fetchText, githubSync: repo, retryDelayMs: 0 }
  );
}

function remoteItemGuids(xml) {
  return [...xml.matchAll(/itemGuid="([^"]+)"/g)].map((m) => m[1]);
}

const TWO_SHOWS = {
  [SHOWS_URL]: showsPage([['bowl-after-bowl', 'Bowl After Bowl'], ['homegrown-hits', 'Homegrown Hits']]),
  [BAB_FEED]: showFeed('bab-guid', [['bab-1', 'Wed, 01 Oct 2026 10:00:00 GMT'], ['bab-2', 'Tue, 21 Oct 2026 10:00:00 GMT']]),
  [HGH_FEED]: showFeed('hgh-guid', [['hgh-1', 'Wed, 15 Oct 2026 10:00:00 GMT']])
};

test('generate publishes every show\'s episodes newest-first, plus the run state', async () => {
  const repo = fakeRepo();
  const result = await aggregator(fakeWeb(TWO_SHOWS), repo).generate();

  assert.equal(result.changed, true);
  assert.equal(result.episodeCount, 3);
  assert.deepEqual(remoteItemGuids(repo.contents.get(PLAYLIST_PATH)), ['bab-2', 'hgh-1', 'bab-1']);
  const state = JSON.parse(repo.contents.get(STATE_PATH));
  assert.deepEqual(state.episodes.map((e) => [e.slug, e.itemGuid, e.pubDate]), [
    ['bowl-after-bowl', 'bab-2', '2026-10-21T10:00:00.000Z'],
    ['homegrown-hits', 'hgh-1', '2026-10-15T10:00:00.000Z'],
    ['bowl-after-bowl', 'bab-1', '2026-10-01T10:00:00.000Z']
  ]);
  assert.deepEqual(state.shows.map((s) => [s.slug, s.feedUrl]), [
    ['bowl-after-bowl', BAB_FEED],
    ['homegrown-hits', HGH_FEED]
  ]);
  assert.match(readFileSync(result.path, 'utf8'), /itemGuid="bab-2"/);
});

test('generate sends no PodPing while the playlist is kept out of Podcast Index', async () => {
  const repo = fakeRepo();
  const agg = new SmallGroupPlaylistAggregator(
    { playlistsDir: mkdtempSync(join(tmpdir(), 'smallgroup-test-')), enableGitHubSync: true, podping: { enabled: true } },
    { fetchText: fakeWeb(TWO_SHOWS).fetchText, githubSync: repo, retryDelayMs: 0 }
  );
  let pinged = 0;
  agg.sendPodping = async () => {
    pinged += 1;
  };
  const result = await agg.generate();
  assert.equal(result.changed, true);
  assert.ok(repo.commits.some((c) => c.path === PLAYLIST_PATH), 'the playlist was pushed');
  assert.equal(pinged, 0);
});

test('generate keeps a show\'s previous episodes, in date order, when its feed is down', async () => {
  const repo = fakeRepo();
  await aggregator(fakeWeb(TWO_SHOWS), repo).generate();

  const nextDay = {
    ...TWO_SHOWS,
    [BAB_FEED]: showFeed('bab-guid', [['bab-2', 'Tue, 21 Oct 2026 10:00:00 GMT'], ['bab-3', 'Thu, 23 Oct 2026 10:00:00 GMT']]),
    [HGH_FEED]: new Error('Request failed with status code 503')
  };
  const result = await aggregator(fakeWeb(nextDay), repo).generate();

  assert.deepEqual(result.stale.map((s) => s.name), ['Homegrown Hits']);
  assert.match(result.stale[0].reason, /503/);
  assert.deepEqual(remoteItemGuids(repo.contents.get(PLAYLIST_PATH)), ['bab-3', 'bab-2', 'hgh-1']);
});

test('generate retries a feed that fails transiently before giving up on it', async () => {
  let calls = 0;
  const web = fakeWeb(TWO_SHOWS);
  const flaky = async (url) => {
    if (url === HGH_FEED && ++calls === 1) throw new Error('timeout of 30000ms exceeded');
    return web.fetchText(url);
  };
  const repo = fakeRepo();
  const result = await aggregator({ fetchText: flaky }, repo).generate();

  assert.deepEqual(result.stale, []);
  assert.deepEqual(result.skipped, []);
  assert.equal(calls, 2);
});

test('generate skips a show whose feed fails and has nothing saved', async () => {
  const repo = fakeRepo();
  const result = await aggregator(fakeWeb({ ...TWO_SHOWS, [HGH_FEED]: undefined }), repo).generate();

  assert.deepEqual(result.skipped.map((s) => s.name), ['Homegrown Hits']);
  assert.deepEqual(remoteItemGuids(repo.contents.get(PLAYLIST_PATH)), ['bab-2', 'bab-1']);
});

test('generate does not republish when no show has a new episode', async () => {
  const repo = fakeRepo();
  await aggregator(fakeWeb(TWO_SHOWS), repo).generate();
  const commitsAfterFirstRun = repo.commits.length;

  const result = await aggregator(fakeWeb(TWO_SHOWS), repo).generate();

  assert.equal(result.changed, false);
  assert.equal(repo.commits.length, commitsAfterFirstRun);
});

test('generate republishes a playlist whose channel changed, with no new episode', async () => {
  const repo = fakeRepo();
  await aggregator(fakeWeb(TWO_SHOWS), repo).generate();
  // Yesterday's file, as an older build wrote it: same episodes, one more tag.
  const old = repo.contents.get(PLAYLIST_PATH).replace(
    '<language>en</language>',
    '<podcast:txt purpose="source-feed">https://smallgroupscoop.com/shows/</podcast:txt>\n    <language>en</language>'
  );
  repo.contents.set(PLAYLIST_PATH, old);

  const result = await aggregator(fakeWeb(TWO_SHOWS), repo).generate();

  assert.equal(result.changed, true);
  assert.doesNotMatch(repo.contents.get(PLAYLIST_PATH), /source-feed/);
  assert.deepEqual(remoteItemGuids(repo.contents.get(PLAYLIST_PATH)), ['bab-2', 'hgh-1', 'bab-1']);
});

test('generate drops a show that leaves the shows page', async () => {
  const repo = fakeRepo();
  await aggregator(fakeWeb(TWO_SHOWS), repo).generate();

  const result = await aggregator(
    fakeWeb({ ...TWO_SHOWS, [SHOWS_URL]: showsPage([['bowl-after-bowl', 'Bowl After Bowl'], ['abs-n-a-6-pack', 'ABS'], ['rare-encounter', 'Rare']]) }),
    repo
  ).generate();

  assert.equal(result.changed, true);
  assert.deepEqual(remoteItemGuids(repo.contents.get(PLAYLIST_PATH)), ['bab-2', 'bab-1']);
});

test('generate falls back to the last known show list when the shows page breaks', async () => {
  const repo = fakeRepo();
  await aggregator(fakeWeb(TWO_SHOWS), repo).generate();

  for (const brokenPage of [new Error('Request failed with status code 502'), '<html>Site under construction</html>']) {
    const result = await aggregator(fakeWeb({ ...TWO_SHOWS, [SHOWS_URL]: brokenPage }), repo).generate();
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /last known show list/);
    assert.deepEqual(remoteItemGuids(repo.contents.get(PLAYLIST_PATH)), ['bab-2', 'hgh-1', 'bab-1']);
  }
});

test('generate treats a page listing under half the last known shows as broken', async () => {
  const repo = fakeRepo();
  const fourShows = showsPage([
    ['bowl-after-bowl', 'Bowl After Bowl'], ['homegrown-hits', 'Homegrown Hits'],
    ['abs-n-a-6-pack', 'ABS'], ['rare-encounter', 'Rare']
  ]);
  await aggregator(fakeWeb({ ...TWO_SHOWS, [SHOWS_URL]: fourShows }), repo).generate();

  const oneShow = showsPage([['bowl-after-bowl', 'Bowl After Bowl']]);
  const result = await aggregator(fakeWeb({ ...TWO_SHOWS, [SHOWS_URL]: oneShow }), repo).generate();

  assert.match(result.warnings[0], /last known show list/);
  assert.deepEqual(remoteItemGuids(repo.contents.get(PLAYLIST_PATH)), ['bab-2', 'hgh-1', 'bab-1']);
});

test('generate uses the known guid override for a feed without <podcast:guid>', async () => {
  const repo = fakeRepo();
  await aggregator(fakeWeb({
    [SHOWS_URL]: showsPage([['abs-n-a-6-pack', 'ABS n&#x27; a 6-Pack']]),
    [ABS_FEED]: showFeed(null, [['abs-1', 'Mon, 12 Oct 2026 10:00:00 GMT']])
  }), repo).generate();

  assert.match(
    repo.contents.get(PLAYLIST_PATH),
    /feedGuid="054525df-0123-5647-8421-dd9083e56636" feedUrl="https:\/\/www\.absna6pack\.com\/\?format=rss" itemGuid="abs-1"/
  );
});

const NEW_SHOW_PAGES = {
  [SHOWS_URL]: showsPage([['brand-new-show', 'Brand New Show']]),
  [`${SHOWS_URL}brand-new-show/`]: '<p><a href="https://brandnew.example">Visit the show&#x27;s own site &rarr;</a></p>',
  'https://brandnew.example': `<head>
    <link rel="alternate" type="application/rss+xml" href="/blog/feed/">
    <link rel="alternate" type="application/rss+xml" href="/podcast.xml"></head>`,
  'https://brandnew.example/blog/feed/': '<rss><channel><item><title>A blog post</title></item></channel></rss>',
  'https://brandnew.example/podcast.xml': showFeed(null, [['new-1', 'Mon, 20 Oct 2026 10:00:00 GMT']], 'video')
};

test('generate discovers a new show\'s podcast feed (not its blog feed) and remembers it', async () => {
  const repo = fakeRepo();
  const result = await aggregator(fakeWeb(NEW_SHOW_PAGES), repo).generate();

  assert.deepEqual(result.discovered, [{ name: 'Brand New Show', feedUrl: 'https://brandnew.example/podcast.xml' }]);
  assert.match(result.warnings.join('\n'), /Brand New Show.*no <podcast:guid>/);
  const [line] = repo.contents.get(PLAYLIST_PATH).split('\n').filter((l) => l.includes('remoteItem'));
  assert.match(line, /feedUrl="https:\/\/brandnew\.example\/podcast\.xml" itemGuid="new-1" medium="video"/);
  // No <podcast:guid> and no override: fall back to the URL-derived guid.
  assert.equal(line.match(/feedGuid="([^"]+)"/)[1], feedGuidFromUrl('https://brandnew.example/podcast.xml'));

  const web = fakeWeb(NEW_SHOW_PAGES);
  const second = await aggregator(web, repo).generate();
  assert.deepEqual(second.discovered, []);
  assert.equal(web.requested.includes(`${SHOWS_URL}brand-new-show/`), false, 'remembered feed is reused');
});

test('generate finds a new show\'s feed at a standard location when its site advertises none', async () => {
  const repo = fakeRepo();
  const result = await aggregator(fakeWeb({
    [SHOWS_URL]: showsPage([['quiet-show', 'Quiet Show']]),
    [`${SHOWS_URL}quiet-show/`]: '<a href="https://www.quietshow.example/">Visit the show&#x27;s own site &rarr;</a>',
    'https://www.quietshow.example/': '<head><title>Quiet Show</title></head>',
    'https://www.quietshow.example/feed.xml': '<rss><channel><item><title>Blog post</title></item></channel></rss>',
    'https://feed.quietshow.example/feed.xml': showFeed('quiet-guid', [['quiet-1', 'Mon, 20 Oct 2026 10:00:00 GMT']])
  }), repo).generate();

  assert.deepEqual(result.discovered, [{ name: 'Quiet Show', feedUrl: 'https://feed.quietshow.example/feed.xml' }]);
  assert.deepEqual(remoteItemGuids(repo.contents.get(PLAYLIST_PATH)), ['quiet-1']);
});

test('generate fails without publishing when no show yields any episodes', async () => {
  const repo = fakeRepo();
  await assert.rejects(
    aggregator(fakeWeb({ [SHOWS_URL]: TWO_SHOWS[SHOWS_URL] }), repo).generate(),
    /No episodes/
  );
  assert.equal(repo.commits.length, 0);
});

test('generate in dry-run prints the playlist and writes nothing', async () => {
  const playlistsDir = mkdtempSync(join(tmpdir(), 'smallgroup-test-'));
  const printed = [];
  const originalLog = console.log;
  console.log = (text) => printed.push(text);
  try {
    const result = await new SmallGroupPlaylistAggregator(
      { playlistsDir, enableGitHubSync: false },
      { fetchText: fakeWeb(TWO_SHOWS).fetchText, retryDelayMs: 0, dryRun: true }
    ).generate();
    assert.equal(result.dryRun, true);
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(remoteItemGuids(printed.join('\n')), ['bab-2', 'hgh-1', 'bab-1']);
  assert.deepEqual(readdirSync(playlistsDir), []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { RSSPlaylistGenerator, stablePlaylistGuid, PUBLISHER_FEED } from './RSSPlaylistGenerator.js';

// Header of docs/HGH-music-playlist.xml as published 2026-10-23 19:28 UTC, when
// every rebuild still minted a new <podcast:guid> (this one is not the guid
// Podcast Index holds for the feed, 8aad8bd9-…).
const PUBLISHED = `<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <author>ChadFarrow</author>
    <title>ChadF Homegrown Hits Music Playlist</title>
    <link>https://homegrownhits.xyz</link>
    <podcast:txt purpose="source-feed">https://feed.homegrownhits.xyz/feed.xml</podcast:txt>
    <podcast:medium>musicL</podcast:medium>
    <podcast:guid>825f8edb-2ea1-4595-9fba-7b4dcee11a00</podcast:guid>
    <podcast:txt purpose="episode">Homegrown Hits - Episode 155</podcast:txt>
    <podcast:remoteItem feedGuid="ac746d09-7c3b-5bcd-b28a-f12d6456ca8f" itemGuid="61a16e10-359c-461a-986e-b5d91244beb7"/>
  </channel>
</rss>`;
const PUBLISHED_GUID = '825f8edb-2ea1-4595-9fba-7b4dcee11a00';
const PI_GUID = '8aad8bd9-0eac-4bfe-b290-6c73f7148155';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function counter() {
  let calls = 0;
  const mint = () => {
    calls += 1;
    return 'minted-guid';
  };
  return { mint, calls: () => calls };
}

test('stablePlaylistGuid prefers the configured guid over the published one', () => {
  const { mint, calls } = counter();
  assert.equal(stablePlaylistGuid(PI_GUID, PUBLISHED, mint), PI_GUID);
  assert.equal(calls(), 0);
});

test('stablePlaylistGuid keeps the published guid when none is configured', () => {
  const { mint, calls } = counter();
  assert.equal(stablePlaylistGuid(undefined, PUBLISHED, mint), PUBLISHED_GUID);
  assert.equal(calls(), 0);
});

test('stablePlaylistGuid mints only for a playlist with no guid anywhere', () => {
  const { mint, calls } = counter();
  assert.equal(stablePlaylistGuid(undefined, null, mint), 'minted-guid');
  assert.equal(stablePlaylistGuid('', PUBLISHED.replace(/<podcast:guid>.*<\/podcast:guid>\n/, ''), mint), 'minted-guid');
  assert.equal(calls(), 2);
});

test('every configured feed has its own fixed playlistGuid', () => {
  const config = JSON.parse(readFileSync(new URL('../config/feeds.json', import.meta.url), 'utf8'));
  const guids = config.rssFeeds.map((feed) => feed.playlistGuid);
  for (const [i, guid] of guids.entries()) {
    assert.match(String(guid), UUID, `${config.rssFeeds[i].playlistId} has no playlistGuid`);
  }
  assert.equal(new Set(guids).size, guids.length, 'two feeds share a playlistGuid');
  const hgh = config.rssFeeds.find((feed) => feed.playlistId === 'HGH-music-playlist');
  assert.equal(hgh.playlistGuid, PI_GUID, 'HGH keeps the guid Podcast Index holds');
});

// Drives generatePlaylistFromRSS with the network stubbed out: the RSS parse,
// the published file and the push. The raw-RSS fetch goes to a closed local
// port and fails, which the generator already tolerates.
function generatorReading(published, pushed) {
  const generator = new RSSPlaylistGenerator({
    enableGitHubSync: true,
    playlistsDir: mkdtempSync(join(tmpdir(), 'rss-playlist-')),
    podping: { enabled: false }
  });
  generator.parser = {
    parseURL: async () => ({
      title: 'Homegrown Hits',
      link: 'https://homegrownhits.xyz',
      items: [{ title: 'Homegrown Hits - Episode 155', guid: 'episode-155' }]
    })
  };
  generator.githubSync = {
    getFileContent: async () => published,
    updateFile: async (path, xml) => pushed.push(xml)
  };
  return generator;
}

function feedConfig(extra = {}) {
  return {
    name: 'Homegrown Hits Podcast',
    rssUrl: 'http://127.0.0.1:9/feed.xml',
    playlistId: 'HGH-music-playlist',
    playlistTitle: 'ChadF Homegrown Hits Music Playlist',
    ...extra
  };
}

function guidOf(xml) {
  return xml.match(/<podcast:guid>([^<]+)<\/podcast:guid>/)[1];
}

test('a rebuild publishes the configured guid, not a new one', async () => {
  const pushed = [];
  const config = feedConfig({ playlistGuid: PI_GUID });
  const generator = generatorReading(PUBLISHED, pushed);
  await generator.generatePlaylistFromRSS(config);
  await generator.generatePlaylistFromRSS(config);
  assert.equal(pushed.length, 2);
  assert.deepEqual(pushed.map(guidOf), [PI_GUID, PI_GUID]);
  assert.equal(config.playlistGuid, PI_GUID);
});

test('an unconfigured playlist keeps its published guid and records it for feeds.json', async () => {
  const pushed = [];
  const config = feedConfig();
  await generatorReading(PUBLISHED, pushed).generatePlaylistFromRSS(config);
  assert.equal(guidOf(pushed[0]), PUBLISHED_GUID);
  assert.equal(config.playlistGuid, PUBLISHED_GUID);
});

test('a new playlist mints one guid and reuses it on the next build', async () => {
  const pushed = [];
  const config = feedConfig();
  // A seed playlist with a track but no <podcast:guid> yet.
  const generator = generatorReading(PUBLISHED.replace(/\s*<podcast:guid>.*<\/podcast:guid>/, ''), pushed);
  await generator.generatePlaylistFromRSS(config);
  await generator.generatePlaylistFromRSS(config);
  assert.match(config.playlistGuid, UUID);
  assert.deepEqual(pushed.map(guidOf), [config.playlistGuid, config.playlistGuid]);
});

// The publisher spec trusts the link between a playlist and ChadF's publisher
// feed only when it goes both ways, so every rebuilt playlist must name the
// publisher feed in <podcast:publisher>.
const BACK_LINK = /<podcast:publisher>\s*<podcast:remoteItem ([^>]*)\/>\s*<\/podcast:publisher>/g;

function backLinks(xml) {
  return [...xml.matchAll(BACK_LINK)].map((m) => m[1]);
}

function trackCount(xml) {
  return (xml.match(/<podcast:remoteItem[^>]*itemGuid=/g) || []).length;
}

test('the publisher feed is ChadF\'s, under the URL Podcast Index lists playlists by', () => {
  assert.equal(PUBLISHER_FEED.guid, 'a778e463-ecc3-5219-8f05-f33b3983e173');
  assert.equal(
    PUBLISHER_FEED.url,
    'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/chadf-musicl-publisher.xml'
  );
});

test('a rebuilt playlist links back to the publisher feed, before its medium', async () => {
  const pushed = [];
  await generatorReading(PUBLISHED, pushed).generatePlaylistFromRSS(feedConfig({ playlistGuid: PI_GUID }));
  const links = backLinks(pushed[0]);
  assert.equal(links.length, 1);
  assert.match(links[0], /medium="publisher"/);
  assert.match(links[0], new RegExp(`feedGuid="${PUBLISHER_FEED.guid}"`));
  assert.ok(links[0].includes(`feedUrl="${PUBLISHER_FEED.url}"`));
  assert.doesNotMatch(links[0], /itemGuid/);
  assert.ok(pushed[0].indexOf('<podcast:publisher>') < pushed[0].indexOf('<podcast:medium>musicL'));
});

// The source show as raw RSS: the one track of PUBLISHED, in a valueTimeSplit
// of the episode it was played in. Served locally so the tracks really flow
// (with the fetch failing, every track lands in "Preserved Tracks").
const RAW_RSS = `<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel>
  <title>Homegrown Hits</title>
  <item><title>Homegrown Hits - Episode 155</title><guid>episode-155</guid>
    <podcast:valueTimeSplit startTime="60" duration="200" remotePercentage="90">
      <podcast:remoteItem feedGuid="ac746d09-7c3b-5bcd-b28a-f12d6456ca8f" itemGuid="61a16e10-359c-461a-986e-b5d91244beb7"/>
    </podcast:valueTimeSplit>
  </item>
</channel></rss>`;

test('rebuilding from a published back-link keeps one back-link and the same tracks', async (t) => {
  const server = createServer((req, res) => res.end(RAW_RSS));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const rssUrl = `http://127.0.0.1:${server.address().port}/feed.xml`;

  const pushed = [];
  const generator = generatorReading(PUBLISHED, pushed);
  // Each build reads the file the previous build pushed, back-link included.
  generator.githubSync.getFileContent = async () => pushed.at(-1) ?? PUBLISHED;
  const config = feedConfig({ playlistGuid: PI_GUID, rssUrl });
  for (let i = 0; i < 3; i += 1) await generator.generatePlaylistFromRSS(config);

  assert.equal(pushed.length, 3);
  for (const xml of pushed) {
    assert.equal(backLinks(xml).length, 1);
    assert.equal(trackCount(xml), trackCount(PUBLISHED));
    // The only remoteItem without an itemGuid is the back-link itself.
    assert.equal((xml.match(/<podcast:remoteItem\b/g) || []).length, trackCount(xml) + 1);
  }
});

test('a title with "&" is escaped once, also when it was read back already escaped', async () => {
  const BARE_AMP = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
  for (const title of ['Mutton, Mead & Music Playlist', 'Mutton, Mead &amp; Music Playlist']) {
    const pushed = [];
    await generatorReading(PUBLISHED, pushed).generatePlaylistFromRSS(feedConfig({
      playlistGuid: PI_GUID,
      playlistTitle: title,
      playlistDescription: 'Curated playlist from Mutton, Mead & Music podcast',
      playlistAuthor: 'Chad & Reed'
    }));
    assert.match(pushed[0], /<title>Mutton, Mead &amp; Music Playlist<\/title>/);
    assert.match(pushed[0], /<description>Curated playlist from Mutton, Mead &amp; Music podcast<\/description>/);
    assert.match(pushed[0], /<author>Chad &amp; Reed<\/author>/);
    assert.doesNotMatch(pushed[0], BARE_AMP);
  }
});

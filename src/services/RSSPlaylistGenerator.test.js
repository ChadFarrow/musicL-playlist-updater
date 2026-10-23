import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RSSPlaylistGenerator, stablePlaylistGuid } from './RSSPlaylistGenerator.js';

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

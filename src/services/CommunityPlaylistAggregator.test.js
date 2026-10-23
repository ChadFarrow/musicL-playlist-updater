import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommunityPlaylistAggregator } from './CommunityPlaylistAggregator.js';

const PLAYLIST_PATH = 'docs/localbitcoins-community-playlists.xml';

// Three records as /api/community-boosts returned them on 2026-10-23 (only the
// two fields the aggregator reads), including MMO's permalink guid with a '&'.
const BOOSTS = [
  { podcast_guid: 'd8d2b7e9-3fa3-5414-a6ef-09b082a0acc4', item_guid: 'Buzzsprout-18484353' },
  { podcast_guid: '4d972224-17bb-5000-9e8f-479bad83dfa1', item_guid: 'Buzzsprout-18616734' },
  { podcast_guid: '31740861-81e8-5dda-8801-a2abb2634271', item_guid: 'https://mmo.show/?post_type=podcast&p=4712' }
];

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

function aggregator(boosts, repo) {
  const agg = new CommunityPlaylistAggregator(
    { playlistsDir: mkdtempSync(join(tmpdir(), 'community-test-')), enableGitHubSync: true },
    { get: async () => ({ status: 200, data: { boosts } }) }
  );
  agg.githubSync = repo;
  return agg;
}

// Moves both build dates, as a later run would.
function redated(xml) {
  return xml.replace(/<(pubDate|lastBuildDate)>[^<]*<\/\1>/g, '<$1>Mon, 01 Jan 2024 00:00:00 GMT</$1>');
}

test('a run with nothing new pushes nothing', async () => {
  const repo = fakeRepo();
  const first = await aggregator(BOOSTS, repo).generate();
  assert.equal(first.changed, true);
  assert.equal(repo.commits.length, 1);

  // The next run builds with new dates; the published file has the old ones.
  repo.contents.set(PLAYLIST_PATH, redated(repo.contents.get(PLAYLIST_PATH)));
  const second = await aggregator(BOOSTS, repo).generate();
  assert.equal(second.changed, false);
  assert.equal(second.episodeCount, 3);
  assert.equal(repo.commits.length, 1, 'no second commit');
});

test('a new boost is pushed, ahead of the ones already published', async () => {
  const repo = fakeRepo();
  await aggregator(BOOSTS.slice(1), repo).generate();
  const result = await aggregator(BOOSTS, repo).generate();
  assert.equal(result.changed, true);
  assert.equal(repo.commits.length, 2);
  const guids = [...repo.contents.get(PLAYLIST_PATH).matchAll(/itemGuid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(guids, ['Buzzsprout-18484353', 'Buzzsprout-18616734', 'https://mmo.show/?post_type=podcast&amp;p=4712']);
});

test('a boost that left the snapshot stays, and is not a change by itself', async () => {
  const repo = fakeRepo();
  await aggregator(BOOSTS, repo).generate();
  repo.contents.set(PLAYLIST_PATH, redated(repo.contents.get(PLAYLIST_PATH)));
  const result = await aggregator(BOOSTS.slice(0, 2), repo).generate();
  assert.equal(result.changed, false);
  assert.equal(result.episodeCount, 3);
  assert.equal(repo.commits.length, 1);
});

test('a published file that cannot be read is not "unchanged": the run still pushes', async () => {
  const repo = fakeRepo();
  repo.getFileContent = async () => {
    throw new Error('GitHub API 502');
  };
  const result = await aggregator(BOOSTS, repo).generate();
  assert.equal(result.changed, true);
  assert.equal(repo.commits.length, 1);
});

test('the playlist names no source-feed: the API is not a feed', async () => {
  const repo = fakeRepo();
  await aggregator(BOOSTS, repo).generate();
  const xml = repo.contents.get(PLAYLIST_PATH);
  assert.doesNotMatch(xml, /source-feed/);
  assert.doesNotMatch(xml, /community-boosts/);
  assert.match(xml, /<podcast:medium>podcastL<\/podcast:medium>/);
});

test('a published file that still names the API as source-feed is a change, so it is pushed once', async () => {
  const repo = fakeRepo();
  await aggregator(BOOSTS, repo).generate();
  // The header as published before the tag was removed (2026-10-23).
  const old = repo.contents.get(PLAYLIST_PATH).replace(
    '    <language>en</language>',
    '    <podcast:txt purpose="source-feed">https://localbitcoiners.com/api/community-boosts</podcast:txt>\n    <language>en</language>'
  );
  repo.contents.set(PLAYLIST_PATH, old);
  const result = await aggregator(BOOSTS, repo).generate();
  assert.equal(result.changed, true);
  assert.equal(repo.commits.length, 2);
  assert.doesNotMatch(repo.contents.get(PLAYLIST_PATH), /source-feed/);
});

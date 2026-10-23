import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notifyPodcastIndex, pubnotifyUrl } from './PodcastIndexNotify.js';
import { RSSPlaylistGenerator } from './RSSPlaylistGenerator.js';

const HGH_FEED_ID = 7443404;
// PI's real answer to /hub/pubnotify?id=7443404 on 2026-10-23.
const PI_OK = { status: 'true', description: 'Feed marked for immediate update.' };

function recordingGet(answer) {
  const calls = [];
  const get = async (url, options) => {
    calls.push({ url, options });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { get, calls };
}

test('pubnotifyUrl names the feed by its Podcast Index ID', () => {
  assert.equal(pubnotifyUrl(HGH_FEED_ID), 'https://api.podcastindex.org/api/1.0/hub/pubnotify?id=7443404');
  assert.equal(pubnotifyUrl('7443404'), 'https://api.podcastindex.org/api/1.0/hub/pubnotify?id=7443404');
});

test('pubnotifyUrl refuses anything that is not a positive integer ID', () => {
  for (const bad of [undefined, null, 0, -1, 1.5, '', 'abc', '7443404&url=https://x.example/feed.xml', NaN]) {
    assert.equal(pubnotifyUrl(bad), null, JSON.stringify(bad));
  }
});

test('notifyPodcastIndex reports PI accepting the notification', async () => {
  const { get, calls } = recordingGet({ status: 200, data: PI_OK });
  assert.deepEqual(await notifyPodcastIndex(HGH_FEED_ID, { get }), {
    success: true,
    message: 'Feed marked for immediate update.'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.podcastindex.org/api/1.0/hub/pubnotify?id=7443404');
  assert.equal(calls[0].options.headers['User-Agent'], 'musicl-playlist-updater');
});

test('notifyPodcastIndex reports a "false" status as a failure', async () => {
  const { get } = recordingGet({ status: 200, data: { status: 'false', description: 'Feed not found.' } });
  assert.deepEqual(await notifyPodcastIndex(HGH_FEED_ID, { get }), { success: false, message: 'Feed not found.' });
});

test('notifyPodcastIndex never throws, and sends nothing for a bad ID', async () => {
  const httpError = Object.assign(new Error('Request failed with status code 400'), {
    response: { status: 400, data: { status: 'false', description: 'Invalid parameters.' } }
  });
  assert.deepEqual(await notifyPodcastIndex(HGH_FEED_ID, { get: recordingGet(httpError).get }), {
    success: false,
    message: 'Invalid parameters.'
  });
  const network = recordingGet(new Error('connect ETIMEDOUT'));
  assert.equal((await notifyPodcastIndex(HGH_FEED_ID, { get: network.get })).success, false);
  const none = recordingGet({ status: 200, data: PI_OK });
  assert.equal((await notifyPodcastIndex(undefined, { get: none.get })).success, false);
  assert.equal(none.calls.length, 0);
});

test('every configured feed has its own Podcast Index feed ID', () => {
  const config = JSON.parse(readFileSync(new URL('../config/feeds.json', import.meta.url), 'utf8'));
  const ids = config.rssFeeds.map((feed) => feed.piFeedId);
  for (const [i, id] of ids.entries()) {
    assert.ok(pubnotifyUrl(id), `${config.rssFeeds[i].playlistId} has no piFeedId`);
  }
  assert.equal(new Set(ids).size, ids.length, 'two feeds share a piFeedId');
  assert.equal(config.rssFeeds.find((feed) => feed.playlistId === 'HGH-music-playlist').piFeedId, HGH_FEED_ID);
});

// generatePlaylistFromRSS with the network stubbed: the RSS parse, the
// published file, the push and the notify. The raw-RSS fetch goes to a closed
// local port and fails, which the generator already tolerates.
const PUBLISHED = `<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <podcast:guid>8aad8bd9-0eac-4bfe-b290-6c73f7148155</podcast:guid>
    <podcast:remoteItem feedGuid="ac746d09-7c3b-5bcd-b28a-f12d6456ca8f" itemGuid="61a16e10-359c-461a-986e-b5d91244beb7"/>
  </channel>
</rss>`;

function generator({ sync = true, pushFails = false } = {}) {
  const events = [];
  const gen = new RSSPlaylistGenerator({
    enableGitHubSync: sync,
    playlistsDir: mkdtempSync(join(tmpdir(), 'pi-notify-')),
    podping: { enabled: false }
  });
  gen.parser = { parseURL: async () => ({ link: 'https://homegrownhits.xyz', items: [{ title: 'Episode 155', guid: 'e155' }] }) };
  gen.githubSync = {
    getFileContent: async () => PUBLISHED,
    updateFile: async () => {
      if (pushFails) throw new Error('GitHub said no');
      events.push('push');
    }
  };
  gen.notifyIndex = async (id) => {
    events.push(`notify ${id}`);
    return { success: true, message: 'Feed marked for immediate update.' };
  };
  return { gen, events };
}

function hgh(extra = {}) {
  return { name: 'Homegrown Hits Podcast', rssUrl: 'http://127.0.0.1:9/feed.xml', playlistId: 'HGH-music-playlist', ...extra };
}

test('a pushed playlist with a piFeedId notifies Podcast Index after the push', async () => {
  const { gen, events } = generator();
  const result = await gen.generatePlaylistFromRSS(hgh({ piFeedId: HGH_FEED_ID }));
  assert.equal(result.success, true);
  assert.deepEqual(events, ['push', `notify ${HGH_FEED_ID}`]);
});

test('no notify for a playlist PI does not hold, or when nothing was pushed', async () => {
  const noId = generator();
  await noId.gen.generatePlaylistFromRSS(hgh());
  assert.deepEqual(noId.events, ['push']);

  const noSync = generator({ sync: false });
  await noSync.gen.generatePlaylistFromRSS(hgh({ piFeedId: HGH_FEED_ID }));
  assert.deepEqual(noSync.events, []);

  const failedPush = generator({ pushFails: true });
  await failedPush.gen.generatePlaylistFromRSS(hgh({ piFeedId: HGH_FEED_ID }));
  assert.deepEqual(failedPush.events, []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PodPing, PODPING_MEDIUMS, podpingConfigFrom, pusherRequestUrl } from './PodPing.js';
import { RSSPlaylistGenerator, podpingFeedUrl } from './RSSPlaylistGenerator.js';

const ENDPOINT = 'https://msp-podping.example.up.railway.app/';
const TOKEN = 'test-bearer-token-not-a-real-one';
// Podcast Index's feedUrl for HGH (feed 7443404), as `podcasts/byfeedid` returns it.
const HGH_PI_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';

function recordingGet(answer) {
  const calls = [];
  const get = async (url, options) => {
    calls.push({ url, options });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { get, calls };
}

function podping(answer, config = {}) {
  const web = recordingGet(answer);
  return { web, client: new PodPing({ endpointUrl: ENDPOINT, bearerToken: TOKEN, ...config }, { get: web.get }) };
}

test('pusherRequestUrl builds the request MSP sends: url, reason, medium', () => {
  const url = new URL(pusherRequestUrl(ENDPOINT, { url: HGH_PI_URL, medium: 'musicL', reason: 'update' }));
  assert.equal(url.origin + url.pathname, ENDPOINT);
  assert.deepEqual([...url.searchParams], [
    ['url', HGH_PI_URL],
    ['reason', 'update'],
    ['medium', 'musicL'],
    ['detailed_response', 'true']
  ]);
  const queued = new URL(pusherRequestUrl(ENDPOINT, { url: HGH_PI_URL, medium: 'musicL', reason: 'update', noBroadcast: true }));
  assert.equal(queued.searchParams.get('no_broadcast'), 'true');
});

test('pusherRequestUrl refuses what hivepinger or the schema would not take', () => {
  const ok = { url: HGH_PI_URL, medium: 'musicL', reason: 'update' };
  for (const [what, endpoint, request] of [
    ['lower-case medium', ENDPOINT, { ...ok, medium: 'musicl' }],
    ['unknown medium', ENDPOINT, { ...ok, medium: 'playlist' }],
    ['v0.3 reason', ENDPOINT, { ...ok, reason: 'feed_update' }],
    ['plain-http endpoint', 'http://msp-podping.example.up.railway.app/', ok],
    ['no endpoint', '', ok],
    ['non-http feed', ENDPOINT, { ...ok, url: 'javascript:alert(1)' }],
    ['not a URL', ENDPOINT, { ...ok, url: 'HGH-music-playlist.xml' }]
  ]) {
    assert.equal(pusherRequestUrl(endpoint, request), null, what);
  }
  assert.ok(pusherRequestUrl('http://localhost:8080/', ok), 'the local docker compose pusher');
  assert.ok(PODPING_MEDIUMS.includes('musicL') && PODPING_MEDIUMS.includes('podcastL'));
});

test('sendNotification sends the bearer token and reports what the pusher queued', async () => {
  const { web, client } = podping({ status: 200, data: { message: 'enqueued', reason: 'update', medium: 'musicL', url: HGH_PI_URL } });
  assert.deepEqual(await client.sendNotification(HGH_PI_URL, { medium: 'musicL' }), { success: true, message: 'enqueued' });
  assert.equal(web.calls.length, 1);
  assert.equal(web.calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(new URL(web.calls[0].url).searchParams.get('medium'), 'musicL');
});

test('a duplicate is success: the same ping is already queued', async () => {
  const { client } = podping({ status: 200, data: { message: 'duplicate' } });
  assert.deepEqual(await client.sendNotification(HGH_PI_URL, { medium: 'musicL' }), { success: true, message: 'duplicate' });
});

test('sendNotification never throws and never puts the token in its answer', async () => {
  const unauthorized = Object.assign(new Error('Request failed with status code 401'), {
    response: { status: 401, data: 'Unauthorized' },
    config: { headers: { Authorization: `Bearer ${TOKEN}` } }
  });
  const denied = await podping(unauthorized).client.sendNotification(HGH_PI_URL, { medium: 'musicL' });
  assert.deepEqual(denied, { success: false, message: 'HTTP 401 Unauthorized' });
  assert.ok(!JSON.stringify(denied).includes(TOKEN));

  const offline = await podping(new Error('connect ETIMEDOUT')).client.sendNotification(HGH_PI_URL, { medium: 'musicL' });
  assert.deepEqual(offline, { success: false, message: 'connect ETIMEDOUT' });
});

test('nothing is sent when the pusher is not configured, PodPing is off, or the request is invalid', async () => {
  for (const config of [{ endpointUrl: '' }, { bearerToken: '' }, { enabled: false }]) {
    const { web, client } = podping({ status: 200, data: {} }, config);
    assert.equal((await client.sendNotification(HGH_PI_URL, { medium: 'musicL' })).success, false);
    assert.equal(web.calls.length, 0, JSON.stringify(config));
  }
  const { web, client } = podping({ status: 200, data: {} });
  assert.equal((await client.sendNotification(HGH_PI_URL, { medium: 'musicl' })).success, false);
  assert.equal(web.calls.length, 0);
});

test('podpingConfigFrom reads the environment first, then config.json', () => {
  const fromFile = { podping: { endpointUrl: 'https://file.example/', bearerToken: 'file-token', timeout: 5000 } };
  assert.deepEqual(podpingConfigFrom(fromFile, { PODPING_ENDPOINT_URL: 'https://env.example/', PODPING_BEARER_TOKEN: 'env-token' }), {
    enabled: true,
    timeout: 5000,
    endpointUrl: 'https://env.example/',
    bearerToken: 'env-token'
  });
  assert.deepEqual(podpingConfigFrom({}, {}), { enabled: true, timeout: 10000, endpointUrl: '', bearerToken: '' });
  assert.equal(podpingConfigFrom({ podping: { enabled: false } }, {}).enabled, false);
});

test('a musicL PodPing names the URL Podcast Index lists the playlist under', () => {
  const config = { githubRepoOwner: 'ChadFarrow', githubRepoName: 'chadf-musicl-playlists', githubRepoBranch: 'main' };
  assert.equal(podpingFeedUrl(config, 'HGH-music-playlist'), HGH_PI_URL);
});

test('a pushed musicL playlist is PodPinged as musicL, after the push and the PI notify', async () => {
  const events = [];
  const gen = new RSSPlaylistGenerator({
    enableGitHubSync: true,
    playlistsDir: mkdtempSync(join(tmpdir(), 'podping-')),
    podping: { enabled: true },
    githubRepoOwner: 'ChadFarrow',
    githubRepoName: 'chadf-musicl-playlists',
    githubRepoBranch: 'main'
  });
  gen.parser = { parseURL: async () => ({ link: 'https://homegrownhits.xyz', items: [{ title: 'Episode 155', guid: 'e155' }] }) };
  gen.githubSync = {
    getFileContent: async () => `<rss><channel><podcast:guid>8aad8bd9-0eac-4bfe-b290-6c73f7148155</podcast:guid>
      <podcast:remoteItem feedGuid="ac746d09-7c3b-5bcd-b28a-f12d6456ca8f" itemGuid="61a16e10-359c-461a-986e-b5d91244beb7"/></channel></rss>`,
    updateFile: async () => events.push('push')
  };
  gen.notifyIndex = async (id) => {
    events.push(`notify ${id}`);
    return { success: true, message: 'Feed marked for immediate update.' };
  };
  gen.podping = {
    sendNotification: async (url, options) => {
      events.push(`podping ${options.medium} ${url}`);
      return { success: true, message: 'enqueued' };
    }
  };
  await gen.generatePlaylistFromRSS({
    name: 'Homegrown Hits Podcast',
    rssUrl: 'http://127.0.0.1:9/feed.xml',
    playlistId: 'HGH-music-playlist',
    piFeedId: 7443404
  });
  assert.deepEqual(events, ['push', 'notify 7443404', `podping musicL ${HGH_PI_URL}`]);
});

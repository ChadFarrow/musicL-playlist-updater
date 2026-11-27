import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_NAME, APP_VERSION, APP_LINK, USER_AGENT } from './userAgent.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('USER_AGENT is `<AppName>/<version> (+<link>)`', () => {
  assert.equal(USER_AGENT, `${APP_NAME}/${APP_VERSION} (+${APP_LINK})`);
  assert.match(USER_AGENT, /^[A-Za-z][A-Za-z0-9-]*\/\d+\.\d+\.\d+ \(\+https:\/\/\S+\)$/);
});

test('USER_AGENT names this app and the version in package.json', () => {
  assert.equal(APP_NAME, 'musicL-playlist-updater');
  assert.equal(APP_VERSION, pkg.version);
  assert.ok(USER_AGENT.startsWith(`musicL-playlist-updater/${pkg.version} `));
});

test('USER_AGENT links to the public repo, with no email and no browser name', () => {
  assert.equal(APP_LINK, 'https://github.com/ChadFarrow/musicL-playlist-updater');
  assert.doesNotMatch(USER_AGENT, /@|Mozilla|Chrome|Safari/);
});

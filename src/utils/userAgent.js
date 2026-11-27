// The one User-Agent that every request of this app sends: feed fetches,
// the GitHub API, Podcast Index pubnotify, the PodPing pusher, the
// LocalBitcoiners API and the Small Group Shows pages. Form:
// `<AppName>/<version> (+<link>)`, with no email and no browser imitation.
// The version comes from package.json, so a version bump changes it too.
//
// Until 2026-11-27 the app sent four names: `musicl-playlist-updater`
// (GitHub, PI, PodPing), a `Mozilla/5.0 (compatible; ...)` string (the two
// aggregators), and the `rss-parser` and `axios/<version>` library defaults
// (the RSS feeds). Every host took the new name in a probe on 2026-11-27.
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export const APP_NAME = 'musicL-playlist-updater';
export const APP_VERSION = pkg.version;
export const APP_LINK = 'https://github.com/ChadFarrow/musicL-playlist-updater';
export const USER_AGENT = `${APP_NAME}/${APP_VERSION} (+${APP_LINK})`;

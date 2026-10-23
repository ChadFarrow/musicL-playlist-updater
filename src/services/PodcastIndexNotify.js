/**
 * Tells Podcast Index that a playlist feed changed, through its keyless
 * /hub/pubnotify endpoint, so PI re-crawls the feed instead of waiting for its
 * own poll.
 *
 * Before 2026-10-23 PI never acted on this repo's PodPings (custom_json id
 * `podping` with `reasons`/`urls`, not the `pp_<medium>_<reason>` / `iris`
 * format readers expect) and had not crawled the playlists since 2025-09.
 * PodPings now go out in the right format (PodPing.js), but this call names
 * the feed by ID and reaches PI even when a PodPing does not.
 *
 * The call names the feed by its Podcast Index ID, never by URL: PI holds these
 * feeds under `.../refs/heads/main/docs/<id>.xml` while this repo publishes
 * `.../main/docs/<id>.xml`, and a URL PI does not know may be added to the index
 * as a new feed. A playlist without a `piFeedId` (one PI does not hold) is not
 * notified at all.
 */
import axios from 'axios';

const PUBNOTIFY_URL = 'https://api.podcastindex.org/api/1.0/hub/pubnotify';

/** The pubnotify URL for a PI feed ID, or null when the ID is not a positive integer. */
export function pubnotifyUrl(feedId) {
  const id = typeof feedId === 'string' && /^\d+$/.test(feedId) ? Number(feedId) : feedId;
  return Number.isSafeInteger(id) && id > 0 ? `${PUBNOTIFY_URL}?id=${id}` : null;
}

/**
 * Asks PI to re-crawl one feed. Never throws: a failed notification must not
 * fail a push that already landed, so the answer is `{ success, message }`.
 * `get` is axios.get, injectable for tests.
 */
export async function notifyPodcastIndex(feedId, { get = axios.get, timeout = 10000 } = {}) {
  const url = pubnotifyUrl(feedId);
  if (!url) return { success: false, message: `not a Podcast Index feed ID: ${JSON.stringify(feedId)}` };
  try {
    const response = await get(url, { timeout, headers: { 'User-Agent': 'musicl-playlist-updater' } });
    const body = response?.data || {};
    const message = body.description || `HTTP ${response?.status}`;
    // PI answers status as the STRING "true" or "false".
    return { success: body.status === 'true' || body.status === true, message };
  } catch (error) {
    const body = error.response?.data;
    return { success: false, message: body?.description || error.message };
  }
}

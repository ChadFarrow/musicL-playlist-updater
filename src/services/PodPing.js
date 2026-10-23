/**
 * Sends PodPings through the msp-podping-service pusher
 * (https://github.com/ChadFarrow/msp-podping-service): Caddy bearer-token auth
 * in front of podping-hivepinger, which writes PodPing 1.1 (custom_json id
 * `pp_<medium>_<reason>`, `iris`), batches and dedups, and broadcasts to Hive.
 * The request is the one MSP's notifyPodping sends:
 * `GET <endpoint>?url=…&reason=…&medium=…` with `Authorization: Bearer <token>`.
 *
 * Until 2026-10-23 this class signed Hive ops itself, with custom_json id
 * `podping` and `{"version":"1.0","reasons":[…],"urls":[…]}` — a shape no
 * PodPing schema version accepts — so no reader, Podcast Index included, ever
 * acted on one.
 */
import axios from 'axios';
import { logger } from '../utils/logger.js';

// podping-schemas podping.json, v1.0 + v1.1 mediums; hivepinger's Medium enum.
export const PODPING_MEDIUMS = [
  'mixed', 'podcast', 'podcastL', 'music', 'musicL', 'video', 'videoL', 'film', 'filmL',
  'audiobook', 'audiobookL', 'newsletter', 'newsletterL', 'blog', 'blogL',
  'publisher', 'publisherL', 'course', 'courseL'
];
export const PODPING_REASONS = ['update', 'live', 'liveEnd'];

/** PodPing settings from the environment, then config.json's `podping` section. */
export function podpingConfigFrom(config = {}, env = process.env) {
  return {
    enabled: config.podping?.enabled !== false,
    timeout: config.podping?.timeout || 10000,
    endpointUrl: env.PODPING_ENDPOINT_URL || config.podping?.endpointUrl || '',
    bearerToken: env.PODPING_BEARER_TOKEN || config.podping?.bearerToken || ''
  };
}

/**
 * The pusher request URL, or null when any part is invalid — nothing is sent
 * then. `noBroadcast` asks hivepinger to queue without broadcasting (testing).
 */
export function pusherRequestUrl(endpointUrl, { url, medium, reason, noBroadcast = false }) {
  if (!PODPING_MEDIUMS.includes(medium) || !PODPING_REASONS.includes(reason)) return null;
  let endpoint;
  let feed;
  try {
    endpoint = new URL(endpointUrl);
    feed = new URL(url);
  } catch {
    return null;
  }
  // The bearer token rides in a header, so plain http only to this machine.
  const local = endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname);
  if ((endpoint.protocol !== 'https:' && !local) || !['http:', 'https:'].includes(feed.protocol)) return null;
  endpoint.search = new URLSearchParams({ url: feed.href, reason, medium }).toString();
  if (noBroadcast) endpoint.searchParams.set('no_broadcast', 'true');
  endpoint.searchParams.set('detailed_response', 'true');
  return endpoint.href;
}

export class PodPing {
  /** `get` is axios.get, injectable for tests. */
  constructor(config = {}, { get = axios.get } = {}) {
    this.enabled = config.enabled !== false;
    this.timeout = config.timeout || 10000;
    this.endpointUrl = config.endpointUrl || '';
    this.bearerToken = config.bearerToken || '';
    this.get = get;
  }

  /**
   * Queues one PodPing with the pusher. Never throws, and never logs the token.
   * @param {string} feedUrl - the feed that changed, in the form readers know it by
   * @param {{medium?: string, reason?: string, noBroadcast?: boolean}} options
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async sendNotification(feedUrl, { medium = 'podcast', reason = 'update', noBroadcast = false } = {}) {
    if (!this.enabled) return { success: false, message: 'PodPing disabled' };
    if (!this.endpointUrl || !this.bearerToken) {
      logger.warn('PodPing: pusher not configured (set PODPING_ENDPOINT_URL and PODPING_BEARER_TOKEN)');
      return { success: false, message: 'PodPing pusher not configured' };
    }
    const requestUrl = pusherRequestUrl(this.endpointUrl, { url: feedUrl, medium, reason, noBroadcast });
    if (!requestUrl) {
      logger.warn(`PodPing: not sent, invalid request (url=${feedUrl}, medium=${medium}, reason=${reason})`);
      return { success: false, message: 'Invalid PodPing request' };
    }

    logger.info(`Sending PodPing (${medium}/${reason}) for feed: ${feedUrl}`);
    try {
      const response = await this.get(requestUrl, {
        timeout: this.timeout,
        headers: { Authorization: `Bearer ${this.bearerToken}`, 'User-Agent': 'musicl-playlist-updater' }
      });
      // hivepinger's detailed response: { message: "enqueued" | "duplicate" | …, reason, medium, url }.
      // A duplicate means the same ping is already queued, which is success.
      const message = response?.data?.message || `HTTP ${response?.status}`;
      logger.info(`PodPing queued for ${feedUrl}: ${message}`);
      return { success: true, message };
    } catch (error) {
      // Only status and body: error.config would carry the Authorization header.
      const status = error.response?.status;
      const body = typeof error.response?.data === 'string' ? error.response.data.slice(0, 200) : '';
      const message = status ? `HTTP ${status}${body ? ` ${body}` : ''}` : error.message;
      logger.warn(`Failed to send PodPing for ${feedUrl}: ${message}`);
      return { success: false, message };
    }
  }
}

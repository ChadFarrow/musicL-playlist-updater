/**
 * Build ONE Podcasting 2.0 `podcastL` playlist that follows every show listed
 * at smallgroupscoop.com/shows: the latest episodes from each show, newest
 * first across the whole network.
 *
 * The site publishes no feed URLs (and no JSON/OPML), so the show list is read
 * from the /shows/ page and each show's RSS feed comes from KNOWN_FEEDS, from a
 * feed remembered in the run state, or — for a show that just joined — from
 * best-effort discovery via the show's own website.
 *
 * HTML is parsed with regexes rather than cheerio: the locked cheerio needs
 * Node >= 20.18.1 and CI runs Node 18, and daily-update.js imports this module
 * at load time, so a cheerio import would take down the whole daily run.
 */

import axios from 'axios';
import { createHash } from 'crypto';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import Parser from 'rss-parser';
import { logger } from '../utils/logger.js';
import { withRetry, isAccessError } from '../utils/retry.js';
import { escapeXml, sameApartFromBuildDates } from '../utils/xml.js';

const SHOWS_URL = 'https://smallgroupscoop.com/shows/';
const EPISODES_PER_SHOW = 10;
const PLAYLIST_TITLE = 'Small Group Shows';
const PLAYLIST_AUTHOR = 'ChadF';
const PLAYLIST_DESCRIPTION =
  'The latest episodes from every show on smallgroupscoop.com/shows, newest first.';
// Stable identity across runs: a remotely-published feed must keep the same
// <podcast:guid> every time it is regenerated, so this is hardcoded.
const PLAYLIST_GUID = '5da03898-d837-435d-9474-4be9a6c95e13';
const PLAYLIST_ID = 'smallgroup-shows-playlist';
// No PodPing for this playlist yet: it is not in Podcast Index, on purpose, and
// a PodPing reader may add a feed it does not know. Set to true once it is in PI.
const SEND_PODPING = false;
// Cover art: docs/smallgroup-shows-playlist-art.png in the target repo, by its
// raw.githubusercontent.com URL. Set to '' and no <image> is written.
const PLAYLIST_IMAGE_URL =
  'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/smallgroup-shows-playlist-art.png';
// Run state the XML can't carry (episode dates, each show's feed). Kept out of
// docs/ so it is never served or discovered as a playlist.
const STATE_PATH = `state/${PLAYLIST_ID}.json`;

// Verified feeds for the shows on the page (checked 2026-10-23). A show that
// isn't listed here is discovered from its own website. `feedGuid` overrides
// feeds with no <podcast:guid> whose Podcast Index guid can't be derived from
// their current URL.
const KNOWN_FEEDS = {
  'abs-n-a-6-pack': {
    name: "ABS n' a 6-Pack",
    feedUrl: 'https://www.absna6pack.com/?format=rss',
    feedGuid: '054525df-0123-5647-8421-dd9083e56636'
  },
  'before-the-sch3m3s': { name: 'Before The Sch3m3s', feedUrl: 'https://music.behindthesch3m3s.com/b4ts%20feed/feed.xml' },
  'behind-the-sch3m3s': { name: 'Behind the Sch3m3s', feedUrl: 'https://feed.behindthesch3m3s.com/feed.xml' },
  'bowl-after-bowl': { name: 'Bowl After Bowl', feedUrl: 'https://feed.bowlafterbowl.com/feed.xml' },
  'chad-and-reeds-podcast': {
    name: 'Chad and Reeds Podcast',
    feedUrl: 'https://serve.podhome.fm/rss/7c6f7875-2b73-491e-b32c-e2c8d6e91d53'
  },
  'homegrown-hits': { name: 'Homegrown Hits', feedUrl: 'https://feed.homegrownhits.xyz/feed.xml' },
  'hyper-spaceout': { name: 'Hyper SpaceOut', feedUrl: 'https://feed.falsefinish.club/HSO/podcast-rss.xml' },
  'into-the-doerfelverse': {
    name: 'Into The Doerfelverse',
    feedUrl: 'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml'
  },
  'lightning-thrashes': { name: 'Lightning Thrashes', feedUrl: 'https://sirlibre.com/lightning-thrashes-rss.xml' },
  'millennial-media-offensive': { name: 'Millennial Media Offensive', feedUrl: 'https://mmo.show/wp-content/feed.xml' },
  'mutton-mead-music': { name: 'Mutton, Mead & Music', feedUrl: 'https://mmmusic.show/podcast/feed.xml' },
  'rare-encounter': { name: 'Rare Encounter', feedUrl: 'https://rareencounter.net/feed.xml' },
  'revdocs-revival': { name: "RevDoc's Revival", feedUrl: 'https://folkhour.com/feed.xml' }
};

const USER_AGENT =
  'Mozilla/5.0 (compatible; musicL-playlist-updater/1.0; +https://github.com/ChadFarrow/chadf-musicl-playlists)';
const FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRIES = 2;
const FETCH_RETRY_DELAY_MS = 10000;
// Podcasting 2.0 namespace for deriving a feed's <podcast:guid> from its URL.
const FEED_GUID_NAMESPACE = 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6';

// Only a show's top-level page (/shows/<slug>/), never the index or sub-pages.
const SHOW_LINK_REGEX =
  /<a\b[^>]*\bhref=["'](?:https?:\/\/(?:www\.)?smallgroupscoop\.com)?\/shows\/([A-Za-z0-9_-]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
const ANCHOR_REGEX = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const MEDIA_URL_REGEX = /\.(mp3|m4a|mp4|m4v|aac|ogg|oga|opus|wav|flac|mov|webm)(\?|$)/i;

export class SmallGroupPlaylistAggregator {
  /**
   * @param {object} config - same shape daily-update.js/scripts build:
   *   { playlistsDir, githubToken, githubRepoOwner, githubRepoName,
   *     githubRepoBranch, enableGitHubSync, podping }
   * @param {object} [opts]
   * @param {string} [opts.outputPath]   - override the local output path
   * @param {boolean} [opts.dryRun]      - print XML instead of writing/pushing
   * @param {(url: string) => Promise<string>} [opts.fetchText] - HTTP GET as text
   * @param {object} [opts.githubSync]   - GitHubSync-compatible client
   * @param {number} [opts.retryDelayMs] - wait between fetch retries
   */
  constructor(config = {}, opts = {}) {
    this.config = config;
    this.githubPath = `docs/${PLAYLIST_ID}.xml`;
    this.outputPath =
      opts.outputPath || join(config.playlistsDir || './playlists', `${PLAYLIST_ID}.xml`);
    this.dryRun = Boolean(opts.dryRun);
    this.fetchText = opts.fetchText || fetchText;
    this.githubSync = opts.githubSync || null;
    this.retryDelayMs = opts.retryDelayMs ?? FETCH_RETRY_DELAY_MS;
  }

  async initializeGitHubSync() {
    if (this.config.githubToken && !this.githubSync) {
      const { GitHubSync } = await import('./GitHubSync.js');
      this.githubSync = new GitHubSync(
        this.config.githubToken,
        this.config.githubRepoOwner,
        this.config.githubRepoName,
        this.config.githubRepoBranch
      );
    }
  }

  async generate() {
    logger.info(`Generating "${PLAYLIST_TITLE}" podcastL playlist from ${SHOWS_URL}`);
    const report = { stale: [], skipped: [], discovered: [], warnings: [] };

    if (this.config.enableGitHubSync) {
      await this.initializeGitHubSync();
    }
    const state = await this.loadState(report);
    const shows = await this.loadShowList(state, report);

    // Each show's newest episodes; a show whose feed fails keeps the episodes
    // saved by the last run instead of vanishing from the playlist.
    const episodesBySlug = new Map();
    const nextShows = [];
    for (const show of shows) {
      const saved = state.shows.find((s) => s.slug === show.slug);
      try {
        const fresh = await this.fetchShow(show, saved, report);
        episodesBySlug.set(show.slug, fresh.episodes);
        nextShows.push(fresh.show);
        logger.info(`${show.name}: ${fresh.episodes.length} episode(s) from ${fresh.show.feedUrl}`);
      } catch (error) {
        // Still a listed show: remembered for the show-list fallback.
        nextShows.push(saved || { slug: show.slug, name: show.name });
        const savedEpisodes = state.episodes.filter((e) => e.slug === show.slug);
        if (savedEpisodes.length > 0) {
          episodesBySlug.set(show.slug, savedEpisodes);
          report.stale.push({ name: show.name, reason: error.message });
          logger.warn(`${show.name}: ${error.message} — kept ${savedEpisodes.length} previous episode(s)`);
        } else {
          report.skipped.push({ name: show.name, reason: error.message });
          logger.warn(`${show.name}: ${error.message} — skipped`);
        }
      }
    }

    if (episodesBySlug.size === 0) {
      throw new Error('No episodes from any Small Group show — nothing to write.');
    }

    const episodes = mergeEpisodes(episodesBySlug, shows.map((s) => s.slug));
    const xml = buildPlaylistXml(episodes, { imageUrl: PLAYLIST_IMAGE_URL });
    const summary = { ...report, episodeCount: episodes.length, showCount: episodesBySlug.size };

    if (this.dryRun) {
      logger.info(`--dry-run: printing XML instead of writing (${episodes.length} episodes)`);
      console.log(xml);
      return { success: true, changed: true, dryRun: true, path: null, ...summary };
    }

    // Compared with the PUBLISHED file, not the saved episode list: a change to
    // the channel (cover art, a removed tag) must reach the feed even on a day
    // no show releases an episode.
    const published = this.githubSync ? await this.githubSync.getFileContent(this.githubPath) : null;
    if (published !== null && sameApartFromBuildDates(published, xml)) {
      logger.info('No new Small Group episodes — playlist unchanged');
      return { success: true, changed: false, path: null, githubPath: this.githubPath, ...summary };
    }

    this.ensureDirectoryExists(this.config.playlistsDir || './playlists');
    writeFileSync(this.outputPath, xml, 'utf8');
    logger.info(`Wrote local playlist: ${this.outputPath} (${episodes.length} episodes)`);

    if (this.config.enableGitHubSync) {
      if (this.githubSync) {
        const message = `Auto-update ${PLAYLIST_TITLE} — ${episodes.length} episode(s) from ${episodesBySlug.size} show(s)`;
        await this.githubSync.updateFile(this.githubPath, xml, message);
        const nextState = { updatedAt: new Date().toISOString(), shows: nextShows, episodes };
        await this.githubSync.updateFile(STATE_PATH, `${JSON.stringify(nextState, null, 2)}\n`, message);
        logger.info(`Synced playlist to GitHub: ${this.githubPath}`);
        if (SEND_PODPING) await this.sendPodping();
      } else {
        logger.warn('GitHub sync enabled but no token available; wrote local file only');
      }
    }

    return { success: true, changed: true, path: this.outputPath, githubPath: this.githubPath, ...summary };
  }

  /**
   * The last run's state. Missing or unreadable JSON starts fresh; a failed
   * GitHub read throws, so the run stops and yesterday's playlist stays up.
   */
  async loadState(report) {
    const empty = { shows: [], episodes: [] };
    if (!this.githubSync) return empty;
    const content = await this.githubSync.getFileContent(STATE_PATH);
    if (!content) return empty;
    try {
      const state = JSON.parse(content);
      return {
        shows: Array.isArray(state.shows) ? state.shows : [],
        episodes: Array.isArray(state.episodes) ? state.episodes : []
      };
    } catch (error) {
      report.warnings.push(`Ignored unreadable ${STATE_PATH}: ${error.message}`);
      return empty;
    }
  }

  /**
   * Shows on the /shows/ page. The site is still being built, so a failed
   * fetch — or a page listing under half the shows the last run saw — falls
   * back to the last known list rather than emptying the playlist.
   */
  async loadShowList(state, report) {
    let shows = [];
    let problem;
    try {
      shows = parseShowsPage(await this.fetchWithRetry(SHOWS_URL));
      problem = `only ${shows.length} show(s) found`;
    } catch (error) {
      problem = error.message;
    }
    const lastCount = state.shows.length;
    if (shows.length > 0 && shows.length * 2 >= lastCount) {
      return shows;
    }

    const fallback = new Map(state.shows.map((s) => [s.slug, { slug: s.slug, name: s.name }]));
    for (const [slug, { name }] of Object.entries(KNOWN_FEEDS)) {
      if (!fallback.has(slug)) fallback.set(slug, { slug, name });
    }
    report.warnings.push(`Couldn't read ${SHOWS_URL} (${problem}) — used the last known show list`);
    return [...fallback.values()];
  }

  /** One show's feed and newest episodes; throws if they can't be fetched. */
  async fetchShow(show, saved, report) {
    const known = KNOWN_FEEDS[show.slug];
    let feedUrl = known?.feedUrl || saved?.feedUrl;
    if (!feedUrl) {
      feedUrl = await this.discoverFeed(show.slug);
      report.discovered.push({ name: show.name, feedUrl });
    }

    const feed = await parseFeedEpisodes(await this.fetchWithRetry(feedUrl));
    let feedGuid = known?.feedGuid || feed.feedGuid;
    if (!feedGuid) {
      feedGuid = feedGuidFromUrl(feedUrl);
      report.warnings.push(`${show.name}: feed has no <podcast:guid>; using ${feedGuid}, derived from its URL`);
    }

    return {
      show: { slug: show.slug, name: show.name, feedUrl, feedGuid },
      episodes: feed.episodes.map((episode) => ({
        slug: show.slug,
        feedGuid,
        feedUrl,
        itemGuid: episode.itemGuid,
        pubDate: episode.pubDate,
        ...(feed.medium ? { medium: feed.medium } : {})
      }))
    };
  }

  /**
   * Best-effort feed lookup for a show not in KNOWN_FEEDS: its smallgroupscoop
   * page links the show's own site, which may advertise RSS feeds; failing
   * that, standard feed locations are tried. The first candidate with
   * audio/video episodes wins (sites often advertise a blog feed too).
   */
  async discoverFeed(slug) {
    const siteUrl = findOwnSiteLink(await this.fetchWithRetry(`${SHOWS_URL}${slug}/`));
    if (!siteUrl) throw new Error('no feed known and no own-site link on its show page');

    const advertised = findFeedLinks(await this.fetchWithRetry(siteUrl), siteUrl);
    for (const candidate of new Set([...advertised, ...standardFeedUrls(siteUrl)])) {
      try {
        if (looksLikePodcastFeed(await this.fetchWithRetry(candidate))) return candidate;
      } catch (error) {
        logger.debug(`Feed candidate ${candidate} failed: ${error.message}`);
      }
    }
    throw new Error(`no feed known and ${siteUrl} advertises no podcast feed`);
  }

  fetchWithRetry(url) {
    return withRetry(() => this.fetchText(url), {
      retries: FETCH_RETRIES,
      delayMs: this.retryDelayMs,
      shouldRetry: (error) => !isAccessError(error),
      onRetry: (error, attempt) => logger.warn(`Retry ${attempt}/${FETCH_RETRIES} fetching ${url}: ${error.message}`)
    });
  }

  // Same non-fatal PodPing as RSSPlaylistGenerator, so apps refresh promptly.
  async sendPodping() {
    if (!this.config.podping?.enabled) return;
    try {
      const { PodPing } = await import('./PodPing.js');
      const playlistFeedUrl = `https://raw.githubusercontent.com/${this.config.githubRepoOwner}/${this.config.githubRepoName}/${this.config.githubRepoBranch || 'main'}/${this.githubPath}`;
      const result = await new PodPing(this.config.podping).sendNotification(playlistFeedUrl, { medium: 'podcastL' });
      if (result.success) {
        logger.info(`PodPing notification sent for ${playlistFeedUrl}`);
      } else {
        logger.warn(`PodPing notification failed: ${result.message}`);
      }
    } catch (error) {
      logger.warn(`Failed to send PodPing notification: ${error.message}`);
    }
  }

  ensureDirectoryExists(dir) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

// Where feeds commonly live when a site doesn't advertise one; several network
// shows use feed.<site>/feed.xml (e.g. feed.bowlafterbowl.com/feed.xml).
function standardFeedUrls(siteUrl) {
  const { origin, hostname } = new URL(siteUrl);
  const bareHost = hostname.replace(/^www\./, '');
  return [
    `${origin}/feed.xml`,
    `https://feed.${bareHost}/feed.xml`,
    `${origin}/podcast.xml`,
    `${origin}/rss.xml`,
    `${origin}/feed/podcast/`
  ];
}

async function fetchText(url) {
  const response = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: FETCH_TIMEOUT_MS,
    responseType: 'text'
  });
  return response.data;
}

/**
 * Shows linked from the /shows/ page, de-duplicated (each show is linked
 * several times), in page order.
 * @returns {{slug: string, name: string}[]}
 */
export function parseShowsPage(html) {
  const shows = new Map();
  for (const match of html.matchAll(SHOW_LINK_REGEX)) {
    const slug = match[1];
    const name = textContent(match[2]);
    if (!shows.has(slug)) {
      shows.set(slug, name);
    } else if (!shows.get(slug) && name) {
      shows.set(slug, name);
    }
  }
  return [...shows].map(([slug, name]) => ({ slug, name }));
}

/** The "Visit the show's own site" link on a smallgroupscoop.com show page. */
export function findOwnSiteLink(html) {
  for (const match of html.matchAll(ANCHOR_REGEX)) {
    const href = decodeHtmlEntities(match[1]);
    if (/^https?:\/\//i.test(href) && /own site/i.test(textContent(match[2]))) {
      return href;
    }
  }
  return null;
}

/** RSS/Atom `<link rel="alternate">` URLs advertised by a web page, made absolute. */
export function findFeedLinks(html, baseUrl) {
  const links = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const rel = (attrs.rel || '').toLowerCase().split(/\s+/);
    if (!rel.includes('alternate') || !attrs.href) continue;
    if (!/^application\/(rss|atom)\+xml$/i.test(attrs.type || '')) continue;
    try {
      links.push(new URL(decodeHtmlEntities(attrs.href), baseUrl).toString());
    } catch {
      // Unparseable href — not a usable candidate.
    }
  }
  return links;
}

/**
 * True when at least one regular <item> carries an audio/video enclosure.
 * Blog feeds (which show sites often advertise instead) have none.
 */
export function looksLikePodcastFeed(xml) {
  for (const item of xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []) {
    for (const tag of item.match(/<enclosure\b[^>]*>/gi) || []) {
      const attrs = parseAttributes(tag);
      if (/^(audio|video)\//i.test(attrs.type || '') || MEDIA_URL_REGEX.test(attrs.url || '')) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The channel-level <podcast:guid>. Regex rather than namespace-aware parsing:
 * many feeds bind the `podcast:` prefix to the old GitHub namespace URI.
 */
export function extractChannelGuid(xml) {
  return channelTag(xml, 'podcast:guid');
}

/** The channel-level <podcast:medium> (e.g. `video`), or null. */
export function extractChannelMedium(xml) {
  return channelTag(xml, 'podcast:medium');
}

/**
 * A feed's channel guid/medium plus its newest regular episodes (liveItems are
 * not <item>s, so rss-parser never returns them). Undated episodes sort last.
 * @returns {Promise<{feedGuid: string|null, medium: string|null,
 *   episodes: {itemGuid: string, pubDate: string|null}[]}>}
 */
export async function parseFeedEpisodes(xml, limit = EPISODES_PER_SHOW) {
  const feed = await new Parser().parseString(xml);
  const episodes = (feed.items || [])
    .map((item) => {
      const time = Date.parse(item.isoDate || item.pubDate || '');
      return {
        itemGuid: String(item.guid ?? item.id ?? '').trim(),
        time: Number.isNaN(time) ? -Infinity : time
      };
    })
    .filter((episode) => episode.itemGuid)
    .sort((a, b) => b.time - a.time)
    .slice(0, limit)
    .map(({ itemGuid, time }) => ({
      itemGuid,
      pubDate: time === -Infinity ? null : new Date(time).toISOString()
    }));
  return { feedGuid: extractChannelGuid(xml), medium: extractChannelMedium(xml), episodes };
}

/**
 * The Podcasting 2.0 feed guid: UUIDv5 of the feed URL without its scheme or
 * trailing slashes. Only a fallback — Podcast Index keeps the guid of the URL a
 * feed was first indexed under, which may differ from its current URL.
 */
export function feedGuidFromUrl(url) {
  const name = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '');
  const namespace = Buffer.from(FEED_GUID_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(namespace).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Every show's episodes in one list, newest first. Ties and undated episodes
 * keep page order; shows missing from `showOrder` (left the page) drop out.
 */
export function mergeEpisodes(episodesBySlug, showOrder) {
  const sortTime = (episode) => (episode.pubDate ? Date.parse(episode.pubDate) : -Infinity);
  return showOrder
    .flatMap((slug) => episodesBySlug.get(slug) || [])
    .sort((a, b) => sortTime(b) - sortTime(a));
}

/**
 * The playlist feed: same channel shape as CommunityPlaylistAggregator, a flat
 * podcastL list of remoteItems (no musicL episode markers). `medium` is only
 * written for shows that aren't plain podcasts (e.g. a video feed).
 *
 * No `<podcast:txt purpose="source-feed">`: thirteen shows have no single
 * source feed, and the tag would name a web page, which boostmebitch downloads
 * as the show the list was built from. (The daily RSS loop never takes this
 * playlist either way: `parseFeedsMarkdown` keeps only musicL playlist IDs.)
 */
export function buildPlaylistXml(episodes, { imageUrl = '', pubDate = new Date().toUTCString() } = {}) {
  const lines = episodes.map((episode) => {
    const medium = xmlMedium(episode);
    return `    <podcast:remoteItem feedGuid="${escapeXml(episode.feedGuid)}" feedUrl="${escapeXml(episode.feedUrl)}" itemGuid="${escapeXml(episode.itemGuid)}"${medium ? ` medium="${escapeXml(medium)}"` : ''}/>`;
  });
  const image = imageUrl
    ? `
    <image>
      <url>${escapeXml(imageUrl)}</url>
    </image>`
    : '';

  return `<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <author>${escapeXml(PLAYLIST_AUTHOR)}</author>
    <title>${escapeXml(PLAYLIST_TITLE)}</title>
    <description>${escapeXml(PLAYLIST_DESCRIPTION)}</description>
    <link>${escapeXml(SHOWS_URL)}</link>
    <language>en</language>
    <pubDate>${pubDate}</pubDate>
    <lastBuildDate>${pubDate}</lastBuildDate>${image}
    <podcast:medium>podcastL</podcast:medium>
    <podcast:guid>${PLAYLIST_GUID}</podcast:guid>
${lines.join('\n')}
  </channel>
</rss>`;
}

function xmlMedium(episode) {
  return episode.medium && episode.medium !== 'podcast' ? episode.medium : null;
}

// Value of a channel-level tag: liveItems are cut out (some hosts, e.g.
// Podhome, put them before the channel's own tags) and only the text before
// the first <item> is searched, so per-episode tags never leak in.
function channelTag(xml, tagName) {
  const header = xml
    .replace(/<podcast:liveItem[\s>][\s\S]*?<\/podcast:liveItem>/gi, '')
    .split(/<item[\s>]/i)[0];
  const match = header.match(new RegExp(`<${tagName}>\\s*([^<]+?)\\s*</${tagName}>`, 'i'));
  return match ? match[1] : null;
}

function parseAttributes(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    attrs[match[1].toLowerCase()] = match[3];
  }
  return attrs;
}

function textContent(html) {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeHtmlEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isNaN(point) ? entity : String.fromCodePoint(point);
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });
}

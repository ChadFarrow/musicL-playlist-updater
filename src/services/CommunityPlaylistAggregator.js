import axios from 'axios';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

/**
 * Aggregate the podcast episodes surfaced at localbitcoiners.com/feeds into ONE
 * Podcasting 2.0 `podcastL` playlist (the spoken-word / list-medium analog of
 * the `musicL` playlists this repo generates from RSS feeds).
 *
 * Unlike RSSPlaylistGenerator (one source RSS feed -> one playlist), this pulls
 * from the site's community-boosts JSON API. localbitcoiners.com/feeds is a JS
 * app: its static HTML carries no feed data, but its "Podcast Boosts" tab reads
 * a pre-computed snapshot from /api/community-boosts. Each entry in `boosts[]`
 * carries `podcast_guid` (-> feedGuid) and `item_guid` (-> itemGuid), which is
 * exactly what a remoteItem needs.
 *
 * The generated file is published to the target repo as
 * docs/localbitcoins-community-playlists.xml, alongside the musicL playlists.
 *
 * Output format mirrors RSSPlaylistGenerator.generateMusicLXML() (same channel
 * shape, same 6-space self-closing <podcast:remoteItem> lines), with two
 * differences: <podcast:medium> is `podcastL`, and there is no episode grouping
 * (the JSON has no per-episode titles), so it is a flat remoteItem-only list.
 */

const DEFAULT_API_URL = 'https://localbitcoiners.com/api/community-boosts';
const DEFAULT_PLAYLIST_ID = 'localbitcoins-community-playlists';
const PLAYLIST_TITLE = 'LocalBitcoiners Community Playlist';
const PLAYLIST_AUTHOR = 'ChadF';
const PLAYLIST_LINK = 'https://localbitcoiners.com/feeds';
const PLAYLIST_DESCRIPTION =
  'A podcastL playlist aggregating podcast episodes the Local Bitcoiners community has boosted, sourced from localbitcoiners.com/feeds.';
// Stable identity across runs. A remotely-published feed must keep the same
// <podcast:guid> every time it is regenerated, so this is hardcoded (never
// randomized per run).
const PLAYLIST_GUID = 'd3f1a5e0-9c4b-4e7a-8f2d-6b1c0a9e5d3f';

const USER_AGENT =
  'Mozilla/5.0 (compatible; musicL-playlist-updater/1.0; +https://github.com/ChadFarrow/chadf-musicl-playlists)';
const FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRIES = 2;
const FETCH_RETRY_DELAY_MS = 10000;

export class CommunityPlaylistAggregator {
  /**
   * @param {object} config - same shape daily-update.js/scripts build:
   *   { playlistsDir, githubToken, githubRepoOwner, githubRepoName,
   *     githubRepoBranch, enableGitHubSync }
   * @param {object} [opts]
   * @param {string} [opts.apiUrl]     - override the community-boosts API URL
   * @param {string} [opts.outputPath] - override the local output path
   * @param {boolean} [opts.dryRun]    - print XML instead of writing/pushing
   */
  constructor(config = {}, opts = {}) {
    this.config = config;
    this.apiUrl = opts.apiUrl || DEFAULT_API_URL;
    this.playlistId = DEFAULT_PLAYLIST_ID;
    this.githubPath = `docs/${this.playlistId}.xml`;
    this.outputPath =
      opts.outputPath ||
      join(config.playlistsDir || './playlists', `${this.playlistId}.xml`);
    this.dryRun = Boolean(opts.dryRun);
    this.githubSync = null;
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
    logger.info(`Generating "${PLAYLIST_TITLE}" podcastL playlist from ${this.apiUrl}`);

    // 1. Fetch the community-boosts snapshot (transient failures retried).
    const boosts = await withRetry(
      async () => {
        const response = await axios.get(this.apiUrl, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          timeout: FETCH_TIMEOUT_MS
        });
        const data = response.data;
        const list = Array.isArray(data?.boosts) ? data.boosts : null;
        if (!list) {
          throw new Error('Unexpected API response: no "boosts" array');
        }
        return list;
      },
      {
        retries: FETCH_RETRIES,
        delayMs: FETCH_RETRY_DELAY_MS,
        onRetry: (error, attempt) =>
          logger.warn(`Retry ${attempt}/${FETCH_RETRIES} fetching community-boosts: ${error.message}`)
      }
    );

    logger.info(`Loaded ${boosts.length} boost record(s) from API`);

    // 2. Extract feedGuid/itemGuid pairs, skipping records that can't form a
    //    valid remoteItem (missing podcast_guid or item_guid).
    const fresh = [];
    const seen = new Set();
    let skipped = 0;
    for (const b of boosts) {
      const feedGuid = (b.podcast_guid || '').trim();
      const itemGuid = (b.item_guid || '').trim();
      if (!feedGuid || !itemGuid) {
        skipped++;
        continue;
      }
      const key = `${feedGuid}::${itemGuid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push({ feedGuid, itemGuid });
    }
    logger.info(`Extracted ${fresh.length} unique episode(s); skipped ${skipped} record(s) without a usable guid pair`);

    // 3. Merge with the existing published playlist so the rolling snapshot
    //    never shrinks the playlist (grow-only, like RSSPlaylistGenerator).
    let preserved = 0;
    if (this.config.enableGitHubSync) {
      try {
        await this.initializeGitHubSync();
        if (this.githubSync) {
          const existing = await this.githubSync.getFileContent(this.githubPath);
          if (existing) {
            for (const item of this.extractRemoteItems(existing)) {
              const key = `${item.feedGuid}::${item.itemGuid}`;
              if (seen.has(key)) continue;
              seen.add(key);
              fresh.push(item);
              preserved++;
            }
            logger.info(`Merged ${preserved} previously-published episode(s) not in the current snapshot`);
          }
        }
      } catch (error) {
        logger.debug(`Could not read existing playlist for merge: ${error.message}`);
      }
    }

    if (fresh.length === 0) {
      throw new Error('No usable episodes extracted — nothing to write.');
    }

    // 4. Build the podcastL XML.
    const xml = this.buildPlaylistXml(fresh);

    // 5. Dry-run: print and stop.
    if (this.dryRun) {
      logger.info(`--dry-run: printing XML instead of writing (${fresh.length} episodes)`);
      console.log(xml);
      return { success: true, episodeCount: fresh.length, newCount: fresh.length - preserved, path: null, dryRun: true };
    }

    // 6. Write local copy.
    this.ensureDirectoryExists(this.config.playlistsDir || './playlists');
    writeFileSync(this.outputPath, xml, 'utf8');
    logger.info(`Wrote local playlist: ${this.outputPath} (${fresh.length} episodes)`);

    // 7. Sync to the target repo.
    if (this.config.enableGitHubSync) {
      await this.initializeGitHubSync();
      if (this.githubSync) {
        const newCount = fresh.length - preserved;
        await this.githubSync.updateFile(
          this.githubPath,
          xml,
          `Auto-update ${PLAYLIST_TITLE} — ${fresh.length} episode(s) (${newCount} from latest snapshot)`
        );
        logger.info(`Synced playlist to GitHub: ${this.githubPath}`);
      } else {
        logger.warn('GitHub sync enabled but no token available; wrote local file only');
      }
    }

    return {
      success: true,
      episodeCount: fresh.length,
      newCount: fresh.length - preserved,
      path: this.outputPath,
      githubPath: this.githubPath
    };
  }

  /**
   * Extract existing <podcast:remoteItem> entries from a published playlist.
   * Same regex approach as RSSPlaylistGenerator (RSSPlaylistGenerator.js:79-94).
   * Attribute values are XML-decoded back to canonical form so merge dedup keys
   * match the fresh (raw) API values and buildPlaylistXml escapes exactly once.
   */
  extractRemoteItems(xmlContent) {
    const items = [];
    const remoteItemRegex = /<podcast:remoteItem[^>]*\/>/g;
    let match;
    while ((match = remoteItemRegex.exec(xmlContent)) !== null) {
      const tag = match[0];
      const feedGuidMatch = tag.match(/feedGuid=["']([^"']+)["']/);
      const itemGuidMatch = tag.match(/itemGuid=["']([^"']+)["']/);
      if (feedGuidMatch && itemGuidMatch) {
        items.push({
          feedGuid: decodeXmlEntities(feedGuidMatch[1]),
          itemGuid: decodeXmlEntities(itemGuidMatch[1])
        });
      }
    }
    return items;
  }

  buildPlaylistXml(remoteItems) {
    const pubDate = new Date().toUTCString();
    // Escape guid attribute values: some come from the API as permalink URLs
    // containing '&' (e.g. ...?post_type=podcast&p=4712), which would otherwise
    // produce malformed XML.
    const lines = remoteItems.map(
      (it) =>
        `    <podcast:remoteItem feedGuid="${escapeXml(it.feedGuid)}" itemGuid="${escapeXml(it.itemGuid)}"/>`
    );

    return `<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <author>${escapeXml(PLAYLIST_AUTHOR)}</author>
    <title>${escapeXml(PLAYLIST_TITLE)}</title>
    <description>${escapeXml(PLAYLIST_DESCRIPTION)}</description>
    <link>${escapeXml(PLAYLIST_LINK)}</link>
    <podcast:txt purpose="source-feed">${escapeXml(this.apiUrl)}</podcast:txt>
    <language>en</language>
    <pubDate>${pubDate}</pubDate>
    <lastBuildDate>${pubDate}</lastBuildDate>
    <podcast:medium>podcastL</podcast:medium>
    <podcast:guid>${PLAYLIST_GUID}</podcast:guid>
${lines.join('\n')}
  </channel>
</rss>`;
  }

  ensureDirectoryExists(dir) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * XML text-content escaping. Mirrors RSSPlaylistGenerator.escapeXml
 * (RSSPlaylistGenerator.js:503-511). feedGuid/itemGuid values are GUIDs and are
 * interpolated raw, matching the existing generator's convention.
 */
function escapeXml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Reverse of escapeXml, used when reading guid values back out of an existing
 * published playlist so they round-trip to their canonical (raw) form.
 */
function decodeXmlEntities(text) {
  if (!text) return '';
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

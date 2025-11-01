import Parser from 'rss-parser';
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export class RSSPlaylistGenerator {
  constructor(config) {
    this.config = config;
    this.parser = new Parser({
      customFields: {
        item: [
          ['podcast:remoteItem', 'remoteItem'],
          ['podcast:value', 'value'],
          ['podcast:valueRecipient', 'valueRecipient'],
          ['podcast:valueType', 'valueType'],
          ['podcast:valueMethod', 'valueMethod']
        ]
      }
    });
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

  async generatePlaylistFromRSS(feedConfig) {
    try {
      logger.info(`Generating playlist from RSS feed: ${feedConfig.name}`);
      
      // Parse the RSS feed
      const feed = await this.parser.parseURL(feedConfig.rssUrl);
      
      if (!feed.items || feed.items.length === 0) {
        logger.warn(`No items found in feed: ${feedConfig.name}`);
        return { success: false, error: 'No items found in feed' };
      }

      // Generate musicL playlist XML
      const playlistXML = this.generateMusicLXML(feed, feedConfig);
      
      // Save locally
      const localPath = join(this.config.playlistsDir || './playlists', `${feedConfig.playlistId}.xml`);
      this.ensureDirectoryExists(this.config.playlistsDir || './playlists');
      writeFileSync(localPath, playlistXML, 'utf8');
      
      logger.info(`Generated playlist locally: ${localPath}`);

      // Sync to GitHub if enabled
      if (this.config.enableGitHubSync) {
        try {
          await this.initializeGitHubSync();
          if (this.githubSync) {
            const githubPath = `docs/${feedConfig.playlistId}.xml`;
            await this.githubSync.updateFile(githubPath, playlistXML, `Auto-update playlist from ${feedConfig.name} RSS feed`);
            logger.info(`Synced playlist to GitHub: ${githubPath}`);
          }
        } catch (error) {
          logger.error(`Failed to sync playlist to GitHub:`, error);
          throw error;
        }
      }

      return {
        success: true,
        localPath,
        githubPath: `docs/${feedConfig.playlistId}.xml`,
        episodeCount: feed.items.length,
        lastEpisode: feed.items[0]?.title || 'Unknown'
      };

    } catch (error) {
      logger.error(`Error generating playlist from RSS feed ${feedConfig.name}:`, error);
      throw error;
    }
  }

  generateMusicLXML(feed, feedConfig) {
    const guid = feedConfig.playlistGuid || this.generateGUID();
    const pubDate = new Date().toUTCString();
    
    // Get feed GUID (prefer existing from feed, or use config, or generate new)
    const feedGuid = feed.guid || feedConfig.feedGuid || this.generateGUID();
    
    // Generate remote items for all episodes (simple musicL playlist format)
    // Check if feed items have existing remote items, otherwise create them
    const remoteItems = [];
    
    for (const episode of feed.items) {
      // If episode already has a remoteItem, use it
      if (episode.remoteItem) {
        remoteItems.push(`      <podcast:remoteItem feedGuid="${episode.remoteItem.feedGuid}" feedURL="${episode.remoteItem.feedURL || feedConfig.rssUrl}" itemGuid="${episode.remoteItem.itemGuid}"/>`);
      } else {
        // Otherwise, create a remote item from the episode guid
        const itemGuid = episode.guid || episode.link;
        remoteItems.push(`      <podcast:remoteItem feedGuid="${feedGuid}" itemGuid="${itemGuid}"/>`);
      }
    }

    const playlistXML = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0" version="2.0">
  <channel>
    <title><![CDATA[${feedConfig.playlistTitle}]]></title>
    <link>${feed.link || feedConfig.rssUrl}</link>
    <podcast:txt purpose="source-rss">${feedConfig.rssUrl}</podcast:txt>
    <description><![CDATA[${feedConfig.playlistDescription}]]></description>
    <language>en-us</language>
    <copyright><![CDATA[${feedConfig.playlistAuthor}]]></copyright>
    <managingEditor>${feedConfig.playlistAuthor}</managingEditor>
    <pubDate>${pubDate}</pubDate>
    <lastBuildDate>${pubDate}</lastBuildDate>
    <generator>Auto musicL Maker</generator>
    <docs>https://cyber.harvard.edu/rss/rss.html</docs>
    <image>
      <url>${feedConfig.playlistImageUrl || feed.image?.url || ''}</url>
      <title><![CDATA[${feedConfig.playlistTitle}]]></title>
      <link>${feed.link || feedConfig.rssUrl}</link>
    </image>
    <podcast:medium>musicL</podcast:medium>
    <podcast:guid>${guid}</podcast:guid>
${remoteItems.join('\n')}
  </channel>
</rss>`;

    return playlistXML;
  }

  generateGUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  ensureDirectoryExists(dir) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  async checkFeedForUpdates(feedConfig) {
    try {
      logger.info(`Checking RSS feed for updates: ${feedConfig.name}`);
      
      const feed = await this.parser.parseURL(feedConfig.rssUrl);
      
      if (!feed.items || feed.items.length === 0) {
        logger.warn(`No items found in feed: ${feedConfig.name}`);
        return { hasUpdates: false, episodes: [] };
      }

      // Get the latest episode
      const latestEpisode = feed.items[0];
      const latestGuid = latestEpisode.guid || latestEpisode.link;

      // Check if this is a new episode
      const hasUpdates = feedConfig.lastEpisodeGuid !== latestGuid;
      
      if (hasUpdates) {
        logger.info(`New episode detected in ${feedConfig.name}: ${latestEpisode.title}`);
        
        // Update the last checked info
        feedConfig.lastChecked = new Date().toISOString();
        feedConfig.lastEpisodeGuid = latestGuid;
        
        return {
          hasUpdates: true,
          episodes: feed.items,
          feedInfo: feed,
          latestEpisode: latestEpisode
        };
      } else {
        logger.info(`No new episodes in ${feedConfig.name}`);
        feedConfig.lastChecked = new Date().toISOString();
        return { hasUpdates: false, episodes: [] };
      }

    } catch (error) {
      logger.error(`Error checking RSS feed ${feedConfig.name}:`, error);
      throw error;
    }
  }
}

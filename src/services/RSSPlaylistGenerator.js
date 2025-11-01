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

      // Get existing playlist and merge with new episodes
      let existingContent = null;
      let existingPlaylistFormat = null;
      let existingRemoteItems = [];
      
      if (this.config.enableGitHubSync) {
        try {
          await this.initializeGitHubSync();
          if (this.githubSync) {
            existingContent = await this.githubSync.getFileContent(`docs/${feedConfig.playlistId}.xml`);
            if (existingContent) {
              // Detect format: has <item> tags or just remoteItem entries
              const hasItemTags = /<item[^>]*>/.test(existingContent);
              existingPlaylistFormat = hasItemTags ? 'full-items' : 'remoteItem-only';
              logger.info(`Detected existing playlist format: ${existingPlaylistFormat}`);
              
              // Extract existing remoteItems to preserve them
              if (existingPlaylistFormat === 'remoteItem-only') {
                // Match remoteItem tags (may span multiple lines or be on single line)
                const remoteItemRegex = /<podcast:remoteItem[^>]*\/>/g;
                let match;
                while ((match = remoteItemRegex.exec(existingContent)) !== null) {
                  const xml = match[0];
                  const itemGuidMatch = xml.match(/itemGuid=["']([^"']+)["']/);
                  const feedGuidMatch = xml.match(/feedGuid=["']([^"']+)["']/);
                  if (itemGuidMatch && feedGuidMatch) {
                    existingRemoteItems.push({
                      itemGuid: itemGuidMatch[1],
                      feedGuid: feedGuidMatch[1],
                      xml: xml.trim()
                    });
                  }
                }
                logger.info(`Found ${existingRemoteItems.length} existing remoteItems in playlist`);
              }
            }
          }
        } catch (error) {
          logger.debug(`Could not check existing playlist: ${error.message}`);
        }
      }

      // Identify new episodes from RSS feed that aren't already in playlist
      // IMPORTANT: .filter() preserves the original RSS feed order - this ensures
      // tracks are added to the playlist in the same order they appear in the main RSS feed
      const feedGuid = feed.guid || feedConfig.feedGuid || this.generateGUID();
      const existingItemGuids = new Set(existingRemoteItems.map(item => item.itemGuid));
      
      const newEpisodes = feed.items.filter(episode => {
        const itemGuid = episode.guid || episode.link;
        return !existingItemGuids.has(itemGuid);
      });
      
      logger.info(`Found ${newEpisodes.length} new episodes out of ${feed.items.length} total in RSS feed`);

      // Merge existing tracks with new episodes
      const allRemoteItems = [];
      
      // Add new episodes in the exact same order they appear in the main RSS feed
      // This preserves the original feed order - tracks will play in the same sequence
      // as they appear in the source RSS feed (no sorting or reordering)
      for (const episode of newEpisodes) {
        const itemGuid = episode.guid || episode.link;
        if (episode.remoteItem) {
          const feedURL = episode.remoteItem.feedURL || feedConfig.rssUrl;
          allRemoteItems.push(`      <podcast:remoteItem feedGuid="${episode.remoteItem.feedGuid}"${feedURL ? ` feedURL="${feedURL}"` : ''} itemGuid="${episode.remoteItem.itemGuid}"/>`);
        } else {
          allRemoteItems.push(`      <podcast:remoteItem feedGuid="${feedGuid}" itemGuid="${itemGuid}"/>`);
        }
      }
      
      // Add existing tracks after new ones (preserve original formatting but normalize indentation)
      for (const existingItem of existingRemoteItems) {
        // Normalize to standard format with consistent indentation
        let normalizedXml = existingItem.xml;
        // Remove existing indentation/spaces, then add our standard indentation
        normalizedXml = normalizedXml.trim();
        // Ensure it matches our format (if it has extra attributes, preserve them)
        if (!normalizedXml.includes('feedGuid')) {
          // Rebuild if needed
          normalizedXml = `      <podcast:remoteItem feedGuid="${existingItem.feedGuid}" itemGuid="${existingItem.itemGuid}"/>`;
        } else {
          // Just normalize indentation
          normalizedXml = `      ${normalizedXml}`;
        }
        allRemoteItems.push(normalizedXml);
      }
      
      const totalEpisodeCount = allRemoteItems.length;
      logger.info(`Merged playlist: ${newEpisodes.length} new + ${existingRemoteItems.length} existing = ${totalEpisodeCount} total tracks`);

      // Generate musicL playlist XML (preserving existing format)
      const playlistXML = this.generateMusicLXML(feed, feedConfig, existingPlaylistFormat, allRemoteItems);
      
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
            await this.githubSync.updateFile(githubPath, playlistXML, `Auto-update playlist from ${feedConfig.name} RSS feed - Added ${newEpisodes.length} new episode(s)`);
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
        episodeCount: totalEpisodeCount,
        newEpisodeCount: newEpisodes.length,
        existingEpisodeCount: existingRemoteItems.length,
        lastEpisode: feed.items[0]?.title || 'Unknown'
      };

    } catch (error) {
      logger.error(`Error generating playlist from RSS feed ${feedConfig.name}:`, error);
      throw error;
    }
  }

  generateMusicLXML(feed, feedConfig, existingFormat = null, remoteItemsArray = null) {
    const guid = feedConfig.playlistGuid || this.generateGUID();
    const pubDate = new Date().toUTCString();
    
    // Get feed GUID (prefer existing from feed, or use config, or generate new)
    const feedGuid = feed.guid || feedConfig.feedGuid || this.generateGUID();
    
    // Default to remoteItem-only format (like MMT/IAM) unless existing format is detected
    const useFullItems = existingFormat === 'full-items';
    
    if (useFullItems) {
      // Generate full item entries with all metadata (like HGH playlist)
      const itemsXML = feed.items.map(episode => {
        const itemGuid = episode.guid || episode.link;
        let itemXML = `    <item>
      <title><![CDATA[${episode.title || ''}]]></title>
      <guid isPermaLink="false">${itemGuid}</guid>
      <link>${episode.link || ''}</link>
      <pubDate>${episode.pubDate || pubDate}</pubDate>
      <description><![CDATA[${episode.content || episode.contentSnippet || episode.description || ''}]]></description>`;

        // Add enclosure if available
        if (episode.enclosure) {
          itemXML += `
      <enclosure url="${episode.enclosure.url}" type="${episode.enclosure.type || 'audio/mpeg'}" length="${episode.enclosure.length || 0}"/>`;
        }

        // Add value tags if available
        if (episode.value) {
          const valueType = episode.valueType || 'lightning';
          const valueMethod = episode.valueMethod || 'keysend';
          const recipients = episode.valueRecipient || [];
          
          if (recipients.length > 0 || episode.valueRecipient) {
            const recipient = Array.isArray(recipients) ? recipients[0] : recipients;
            itemXML += `
      <podcast:value type="${valueType}" method="${valueMethod}">
        <podcast:valueRecipient name="${recipient.name || ''}" type="${recipient.type || 'node'}" address="${recipient.address || ''}" split="${recipient.split || 0}"/>
      </podcast:value>`;
          }
        }

        itemXML += `
    </item>`;
        return itemXML;
      }).join('\n');

      // Full RSS 2.0 format with itunes namespace
      return `<?xml version="1.0" encoding="UTF-8"?>
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
${itemsXML}
  </channel>
</rss>`;
    } else {
      // Generate remote items only (simplified format like MMT/IAM playlists)
      // Use provided remoteItemsArray if available (merged from existing + new), otherwise generate from feed
      let remoteItems = [];
      
      if (remoteItemsArray && remoteItemsArray.length > 0) {
        // Use the merged remoteItems array (new + existing)
        remoteItems = remoteItemsArray;
      } else {
        // Fallback: generate from feed items only (for new playlists)
        for (const episode of feed.items) {
          // If episode already has a remoteItem, use it
          if (episode.remoteItem) {
            const feedURL = episode.remoteItem.feedURL || feedConfig.rssUrl;
            remoteItems.push(`      <podcast:remoteItem feedGuid="${episode.remoteItem.feedGuid}"${feedURL ? ` feedURL="${feedURL}"` : ''} itemGuid="${episode.remoteItem.itemGuid}"/>`);
          } else {
            // Otherwise, create a remote item from the episode guid
            const itemGuid = episode.guid || episode.link;
            remoteItems.push(`      <podcast:remoteItem feedGuid="${feedGuid}" itemGuid="${itemGuid}"/>`);
          }
        }
      }

      // Simplified format (remoteItem only, no full item entries)
      return `<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <author>${feedConfig.playlistAuthor || 'ChadF'}</author>
    <title>${feedConfig.playlistTitle || ''}</title>
    <description>${feedConfig.playlistDescription || ''}</description>
    <link>${feed.link || feedConfig.rssUrl || ''}</link>
    <podcast:txt purpose="source-feed">${feedConfig.rssUrl}</podcast:txt>
    <language>en</language>
    <pubDate>${pubDate}</pubDate>
    <lastBuildDate>${pubDate}</lastBuildDate>
    <image>
      <url>${feedConfig.playlistImageUrl || feed.image?.url || ''}</url>
    </image>
    <podcast:medium>musicL</podcast:medium>
    <podcast:guid>${guid}</podcast:guid>
${remoteItems.join('\n')}
  </channel>
</rss>`;
    }
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

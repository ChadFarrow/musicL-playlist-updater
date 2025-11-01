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

      // Fetch raw RSS XML to extract feedGuid/itemGuid pairs from valueTimeSplit tags
      let rssXml = null;
      try {
        const response = await axios.get(feedConfig.rssUrl);
        rssXml = response.data;
      } catch (error) {
        logger.warn(`Could not fetch raw RSS XML: ${error.message}`);
      }

      // Get existing playlist and merge with new episodes
      let existingContent = null;
      let existingPlaylistFormat = null;
      let existingRemoteItems = [];
      const existingItemsMap = new Map(); // itemGuid -> existing remoteItem
      
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
                    const remoteItem = {
                      itemGuid: itemGuidMatch[1],
                      feedGuid: feedGuidMatch[1],
                      xml: xml.trim()
                    };
                    existingRemoteItems.push(remoteItem);
                    existingItemsMap.set(remoteItem.itemGuid, remoteItem);
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

      // Extract feedGuid/itemGuid pairs from RSS feed (like Auto-musicL-Maker does)
      // Auto-musicL-Maker extracts all pairs from valueTimeSplit tags in RSS feed order
      const feedGuid = feed.guid || feedConfig.feedGuid || this.generateGUID();
      const allRemoteItems = [];
      const addedItemGuids = new Set();
      const newEpisodes = [];
      const existingEpisodes = [];
      
      // Process RSS feed episodes in order (newest first) - matching Auto-musicL-Maker
      for (const episode of feed.items) {
        try {
          const episodeGuid = episode.guid || episode.link;
          
          if (!episodeGuid) {
            logger.warn(`Skipping episode without GUID: ${episode.title || 'Unknown'}`);
            continue;
          }
          
          // Extract feedGuid/itemGuid pairs from this episode's RSS XML content
          if (rssXml) {
            try {
              // Find this episode's item section in the RSS XML
              const episodeGuidPattern = episodeGuid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const episodeItemRegex = new RegExp(`<item[^>]*>[\\s\\S]*?<guid[^>]*>${episodeGuidPattern}[\\s\\S]*?</item>`, 'i');
              const episodeMatch = rssXml.match(episodeItemRegex);
              
              if (episodeMatch && episodeMatch[0]) {
                const episodeContent = episodeMatch[0];
                
                // Extract feedGuid/itemGuid pairs from valueTimeSplit tags in this episode (in order)
                try {
                  const valueTimeSplitRegex = /<podcast:valueTimeSplit[^>]*>[\s\S]*?<podcast:remoteItem[^>]*feedGuid=["']([^"']+)["'][^>]*itemGuid=["']([^"']+)["'][^>]*\/?>/gi;
                  let match;
                  while ((match = valueTimeSplitRegex.exec(episodeContent)) !== null) {
                    try {
                      const pairFeedGuid = match[1];
                      const pairItemGuid = match[2];
                      
                      if (!pairFeedGuid || !pairItemGuid) {
                        logger.debug(`Skipping invalid pair in episode ${episodeGuid}`);
                        continue;
                      }
                      
                      if (!addedItemGuids.has(pairItemGuid)) {
                        // Check if this item exists in playlist
                        const existingItem = existingItemsMap.get(pairItemGuid);
                        if (existingItem) {
                          // Use existing XML to preserve formatting
                          let normalizedXml = existingItem.xml.trim();
                          if (!normalizedXml.includes('feedGuid')) {
                            normalizedXml = `      <podcast:remoteItem feedGuid="${existingItem.feedGuid}" itemGuid="${existingItem.itemGuid}"/>`;
                          } else {
                            normalizedXml = `      ${normalizedXml}`;
                          }
                          allRemoteItems.push(normalizedXml);
                          addedItemGuids.add(pairItemGuid);
                          existingEpisodes.push(pairItemGuid);
                        } else {
                          // New track from RSS feed
                          allRemoteItems.push(`      <podcast:remoteItem feedGuid="${pairFeedGuid}" itemGuid="${pairItemGuid}"/>`);
                          addedItemGuids.add(pairItemGuid);
                          newEpisodes.push(pairItemGuid);
                        }
                      }
                    } catch (pairError) {
                      logger.debug(`Error processing pair in episode ${episodeGuid}:`, pairError);
                      continue;
                    }
                  }
                } catch (regexError) {
                  logger.debug(`Error extracting valueTimeSplit pairs from episode ${episodeGuid}:`, regexError);
                }
                
                // Also extract standalone remoteItem tags from this episode
                try {
                  const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid=["']([^"']+)["'][^>]*itemGuid=["']([^"']+)["'][^>]*\/?>/gi;
                  let match;
                  while ((match = remoteItemRegex.exec(episodeContent)) !== null) {
                    try {
                      const pairFeedGuid = match[1];
                      const pairItemGuid = match[2];
                      
                      if (!pairFeedGuid || !pairItemGuid) {
                        continue;
                      }
                      
                      // Skip if already added from valueTimeSplit
                      if (!addedItemGuids.has(pairItemGuid)) {
                        const existingItem = existingItemsMap.get(pairItemGuid);
                        if (existingItem) {
                          let normalizedXml = existingItem.xml.trim();
                          if (!normalizedXml.includes('feedGuid')) {
                            normalizedXml = `      <podcast:remoteItem feedGuid="${existingItem.feedGuid}" itemGuid="${existingItem.itemGuid}"/>`;
                          } else {
                            normalizedXml = `      ${normalizedXml}`;
                          }
                          allRemoteItems.push(normalizedXml);
                          addedItemGuids.add(pairItemGuid);
                          existingEpisodes.push(pairItemGuid);
                        } else {
                          allRemoteItems.push(`      <podcast:remoteItem feedGuid="${pairFeedGuid}" itemGuid="${pairItemGuid}"/>`);
                          addedItemGuids.add(pairItemGuid);
                          newEpisodes.push(pairItemGuid);
                        }
                      }
                    } catch (pairError) {
                      logger.debug(`Error processing standalone remoteItem in episode ${episodeGuid}:`, pairError);
                      continue;
                    }
                  }
                } catch (regexError) {
                  logger.debug(`Error extracting standalone remoteItems from episode ${episodeGuid}:`, regexError);
                }
              } else {
                logger.debug(`Could not find episode content in RSS XML for GUID: ${episodeGuid}`);
              }
            } catch (episodeError) {
              logger.debug(`Error processing episode ${episodeGuid}:`, episodeError);
              continue;
            }
          } else {
            logger.debug(`No RSS XML available, skipping extraction for episode ${episodeGuid}`);
          }
        } catch (error) {
          logger.error(`Error processing episode:`, error);
          continue;
        }
      }
      
      // Add any remaining existing tracks not found in RSS feed (at the end)
      // This preserves tracks from older episodes that may have been removed from the RSS feed
      const preservedFromMissingEpisodes = [];
      for (const existingItem of existingRemoteItems) {
        if (!addedItemGuids.has(existingItem.itemGuid)) {
          let normalizedXml = existingItem.xml.trim();
          if (!normalizedXml.includes('feedGuid')) {
            normalizedXml = `      <podcast:remoteItem feedGuid="${existingItem.feedGuid}" itemGuid="${existingItem.itemGuid}"/>`;
          } else {
            normalizedXml = `      ${normalizedXml}`;
          }
          allRemoteItems.push(normalizedXml);
          preservedFromMissingEpisodes.push(existingItem.itemGuid);
        }
      }
      
      const totalEpisodeCount = allRemoteItems.length;
      logger.info(`Reordered playlist from RSS feed: ${newEpisodes.length} new + ${existingEpisodes.length} existing from RSS feed + ${preservedFromMissingEpisodes.length} preserved from missing episodes = ${totalEpisodeCount} total tracks`);

      // If no tracks found, return error
      if (totalEpisodeCount === 0) {
        logger.warn(`No tracks found for playlist ${feedConfig.playlistId}`);
        return { success: false, error: 'No tracks found in playlist or RSS feed' };
      }

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
      logger.error(`Error stack:`, error.stack);
      console.error(`Error generating playlist from RSS feed ${feedConfig.name}:`, error);
      console.error(`Error stack:`, error.stack);
      return {
        success: false,
        error: error.message || 'Unknown error',
        errorStack: error.stack
      };
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

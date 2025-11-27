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
    this.podping = null;
  }

  async initializePodPing() {
    if (this.config.podping?.enabled && !this.podping) {
      const { PodPing } = await import('./PodPing.js');
      this.podping = new PodPing(this.config.podping);
    }
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
      
      // Extract ALL feedGuid/itemGuid pairs from RSS feed in EXACT order as they appear
      // This ensures the playlist matches the exact order in the RSS feed (newest episode first, then by startTime)
      if (rssXml) {
        // Extract all valueTimeSplit pairs from entire RSS feed in document order
        const allPairs = [];
        // Updated regex to handle feedGuid/itemGuid in any order (some feeds have itemGuid before feedGuid)
        // Match valueTimeSplit tag, then capture the remoteItem tag (handles both self-closing and closing tags)
        const valueTimeSplitRegex = /<podcast:valueTimeSplit[^>]*startTime=["']([^"']+)["'][^>]*>[\s\S]*?<podcast:remoteItem[\s\S]*?(?:\/>|<\/podcast:remoteItem>)/gi;
        let match;
        while ((match = valueTimeSplitRegex.exec(rssXml)) !== null) {
          try {
            const startTime = parseFloat(match[1]) || 0;
            // Extract feedGuid and itemGuid from the remoteItem tag (in any order, may span multiple lines)
            const remoteItemTag = match[0].match(/<podcast:remoteItem[\s\S]*?(?:\/>|<\/podcast:remoteItem>)/i)?.[0] || '';
            const feedGuidMatch = remoteItemTag.match(/feedGuid=["']([^"']+)["']/i);
            const itemGuidMatch = remoteItemTag.match(/itemGuid=["']([^"']+)["']/i);
            const pairFeedGuid = feedGuidMatch ? feedGuidMatch[1] : null;
            const pairItemGuid = itemGuidMatch ? itemGuidMatch[1] : null;
            
            if (pairFeedGuid && pairItemGuid) {
              // Determine which episode this belongs to by finding the nearest <item> tag
              const matchIndex = match.index;
              // Find the episode GUID by looking backwards for the most recent <item><guid> tag
              const beforeMatch = rssXml.substring(0, matchIndex);
              const itemMatch = beforeMatch.match(/<item[^>]*>[\s\S]*?<guid[^>]*>([^<]+)<\/guid>/gi);
              let episodeGuid = null;
              let episodeIndex = -1;
              
              if (itemMatch && itemMatch.length > 0) {
                const lastItem = itemMatch[itemMatch.length - 1];
                const guidMatch = lastItem.match(/<guid[^>]*>([^<]+)<\/guid>/i);
                if (guidMatch) {
                  episodeGuid = guidMatch[1].trim();
                  // Find episode index in feed.items - try both guid and link fields
                  episodeIndex = feed.items.findIndex(ep => {
                    const epGuid = ep.guid || ep.link || '';
                    return epGuid === episodeGuid || epGuid.includes(episodeGuid) || episodeGuid.includes(epGuid);
                  });
                  // If still not found, try matching without whitespace
                  if (episodeIndex === -1) {
                    episodeIndex = feed.items.findIndex(ep => {
                      const epGuid = (ep.guid || ep.link || '').trim();
                      return epGuid === episodeGuid.trim();
                    });
                  }
                  if (episodeIndex === -1) {
                    // Try to find by checking if GUID contains episode number (for Episode 109)
                    const epNumMatch = episodeGuid.match(/109/i);
                    if (epNumMatch) {
                      // Episode 109 should be index 0 (newest)
                      episodeIndex = 0;
                    } else {
                      // For HGH, try to match episode GUID by finding similar patterns
                      // Check feed.items titles for episode numbers
                      const epTitleMatch = feed.items.findIndex(ep => {
                        const title = (ep.title || '').toLowerCase();
                        if (episodeGuid.includes('homegrownhits-109') || episodeGuid.includes('109')) {
                          return title.includes('109');
                        }
                        return false;
                      });
                      if (epTitleMatch >= 0) {
                        episodeIndex = epTitleMatch;
                      } else {
                        episodeIndex = feed.items.length; // If not found, put at end
                      }
                    }
                  }
                  
                  // Log if episode not found for debugging HGH
                  if (episodeIndex === feed.items.length && episodeGuid) {
                    logger.debug(`Could not find episode index for GUID: ${episodeGuid}. Feed has ${feed.items.length} episodes.`);
                  }
                }
              }
              
              allPairs.push({
                feedGuid: pairFeedGuid,
                itemGuid: pairItemGuid,
                startTime: startTime,
                episodeIndex: episodeIndex,
                episodeGuid: episodeGuid,
                matchIndex: matchIndex // Preserve original position in RSS feed
              });
            }
          } catch (pairError) {
            logger.debug(`Error processing valueTimeSplit pair:`, pairError);
            continue;
          }
        }
        
        // Preserve document order - RSS feed already has items in correct chronological order
        // The regex match processes the RSS feed top-to-bottom, so allPairs is already in the
        // correct order (newest episode first, then by startTime within each episode).
        // No sorting needed - process items in the order they appear in the feed.
        
        logger.info(`Extracted ${allPairs.length} pairs from RSS feed. First 5 itemGuids: ${allPairs.slice(0, 5).map(p => p.itemGuid).join(', ')}`);
        logger.info(`Episode index distribution: ${Array.from(new Set(allPairs.map(p => p.episodeIndex))).sort((a,b) => a-b).slice(0, 10).join(', ')}`);
        
        // If no pairs found, log diagnostic info about the RSS feed format
        if (allPairs.length === 0) {
          logger.warn(`No valueTimeSplit pairs found in RSS feed for ${feedConfig.name}. Checking feed format...`);
          // Check if feed has any podcast:valueTimeSplit tags
          const hasValueTimeSplit = rssXml && rssXml.includes('<podcast:valueTimeSplit');
          // Check if feed has any podcast:remoteItem tags
          const hasRemoteItem = rssXml && rssXml.includes('<podcast:remoteItem');
          // Check if feed has podcast:value tags
          const hasValue = rssXml && rssXml.includes('<podcast:value');
          // Check if feed has any items
          const hasItems = feed.items && feed.items.length > 0;
          
          logger.warn(`RSS feed diagnostic for ${feedConfig.name}:`);
          logger.warn(`  - Has podcast:valueTimeSplit tags: ${hasValueTimeSplit}`);
          logger.warn(`  - Has podcast:remoteItem tags: ${hasRemoteItem}`);
          logger.warn(`  - Has podcast:value tags: ${hasValue}`);
          logger.warn(`  - Has feed items: ${hasItems} (${feed.items?.length || 0} items)`);
          
          // Log a sample of the RSS feed structure (first 500 chars containing podcast: tags)
          if (rssXml) {
            const valueTagMatch = rssXml.match(/<podcast:value[^>]*>[\s\S]{0,500}/i);
            if (valueTagMatch) {
              logger.debug(`Sample podcast:value structure from ${feedConfig.name}: ${valueTagMatch[0].substring(0, 300)}...`);
            }
          }
        }
        
        // Log first 13 pairs with their episode info for debugging
        if (allPairs.length >= 13) {
          const first13 = allPairs.slice(0, 13);
          logger.info(`First 13 pairs from RSS - Episode indices: ${first13.map(p => p.episodeIndex).join(', ')}`);
          logger.info(`First 13 pairs from RSS - Start times: ${first13.map(p => p.startTime).join(', ')}`);
          logger.info(`First 13 pairs from RSS - itemGuids: ${first13.map(p => p.itemGuid).join(', ')}`);
        }
        
        // Process pairs in sorted order
        for (const pair of allPairs) {
          if (!addedItemGuids.has(pair.itemGuid)) {
            // Check if this item exists in playlist
            const existingItem = existingItemsMap.get(pair.itemGuid);
            if (existingItem) {
              // Use existing XML to preserve formatting
              let normalizedXml = existingItem.xml.trim();
              if (!normalizedXml.includes('feedGuid')) {
                normalizedXml = `      <podcast:remoteItem feedGuid="${existingItem.feedGuid}" itemGuid="${existingItem.itemGuid}"/>`;
              } else {
                normalizedXml = `      ${normalizedXml}`;
              }
              allRemoteItems.push(normalizedXml);
              addedItemGuids.add(pair.itemGuid);
              existingEpisodes.push(pair.itemGuid);
            } else {
              // New track from RSS feed
              allRemoteItems.push(`      <podcast:remoteItem feedGuid="${pair.feedGuid}" itemGuid="${pair.itemGuid}"/>`);
              addedItemGuids.add(pair.itemGuid);
              newEpisodes.push(pair.itemGuid);
            }
          }
        }
        
        // Log first 13 itemGuids that will be in the final playlist
        if (allRemoteItems.length >= 13) {
          const first13Final = allRemoteItems.slice(0, 13);
          const first13ItemGuids = first13Final.map(xml => {
            const match = xml.match(/itemGuid=["']([^"']+)["']/);
            return match ? match[1] : 'unknown';
          });
          logger.info(`First 13 itemGuids in final playlist: ${first13ItemGuids.join(', ')}`);
        }
        
        logger.info(`Extracted ${allPairs.length} feedGuid/itemGuid pairs from RSS feed (preserving document order)`);
      }
      
      // Also extract standalone remoteItem tags from RSS feed (if any)
      if (rssXml) {
        const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid=["']([^"']+)["'][^>]*itemGuid=["']([^"']+)["'][^>]*\/?>/gi;
        let match;
        while ((match = remoteItemRegex.exec(rssXml)) !== null) {
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
            logger.debug(`Error processing standalone remoteItem:`, pairError);
            continue;
          }
        }
      }
      
      // Build a map of all pairs extracted from RSS feed (for validation)
      const rssFeedPairs = new Set();
      if (rssXml) {
        const allRssPairs = rssXml.matchAll(/<podcast:valueTimeSplit[^>]*>[\s\S]*?<podcast:remoteItem[^>]*itemGuid=["']([^"']+)["'][^>]*\/?>/gi);
        for (const match of allRssPairs) {
          rssFeedPairs.add(match[1]);
        }
      }
      
      // Add any remaining existing tracks not found in RSS feed (at the end)
      // BUT only if they're actually missing from RSS feed (not just from older episodes)
      const preservedFromMissingEpisodes = [];
      for (const existingItem of existingRemoteItems) {
        if (!addedItemGuids.has(existingItem.itemGuid)) {
          // Only preserve if it's truly not in the RSS feed
          // If it's in RSS feed but wasn't added, it means it's from an older episode and should be skipped
          // The RSS feed order already includes all episodes, so we don't need to preserve "older" tracks
          if (!rssFeedPairs.has(existingItem.itemGuid)) {
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
            
            // Send PodPing notification after successful GitHub sync
            // PodPing should notify for the playlist feed URL (not the source RSS feed)
            if (this.config.podping?.enabled && this.config.githubRepoOwner && this.config.githubRepoName) {
              try {
                await this.initializePodPing();
                if (this.podping) {
                  // Construct playlist feed URL: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/docs/{playlistId}.xml
                  const playlistFeedUrl = `https://raw.githubusercontent.com/${this.config.githubRepoOwner}/${this.config.githubRepoName}/${this.config.githubRepoBranch || 'main'}/docs/${feedConfig.playlistId}.xml`;
                  logger.info(`Sending PodPing notification for playlist feed: ${playlistFeedUrl}`);
                  const podpingResult = await this.podping.sendNotification(playlistFeedUrl);
                  if (podpingResult.success) {
                    logger.info(`PodPing notification sent for ${feedConfig.name} playlist`);
                  } else {
                    logger.warn(`PodPing notification failed for ${feedConfig.name}: ${podpingResult.message}`);
                  }
                }
              } catch (podpingError) {
                // Non-fatal error - log warning but don't fail the update
                logger.warn(`Failed to send PodPing notification for ${feedConfig.name}: ${podpingError.message}`);
              }
            }
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

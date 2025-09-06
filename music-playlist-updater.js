#!/usr/bin/env node

import Parser from 'rss-parser';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

class MusicPlaylistUpdater {
  constructor(config = {}) {
    this.config = {
      playlistsDir: './playlists',
      ...config
    };
    this.parser = new Parser({
      customFields: {
        feed: [
          ['podcast:podroll', 'podroll'],
          ['podcast:guid', 'guid']
        ],
        item: [
          ['podcast:remoteItem', 'remoteItem'],
          ['podcast:value', 'value'],
          ['podcast:valueRecipient', 'valueRecipient'],
          ['podcast:valueType', 'valueType'],
          ['podcast:valueMethod', 'valueMethod']
        ]
      }
    });
  }

  async updatePlaylist(playlistId) {
    try {
      console.log(`🔄 Updating music playlist: ${playlistId}`);
      
      // Read the existing playlist
      const playlistPath = join(this.config.playlistsDir, `${playlistId}.xml`);
      
      if (!existsSync(playlistPath)) {
        throw new Error(`Playlist not found: ${playlistPath}`);
      }

      const playlistContent = readFileSync(playlistPath, 'utf8');
      
      // Extract RSS URL from podcast:txt tag (support both source-rss and source-feed purposes)
      const rssMatch = playlistContent.match(/<podcast:txt purpose="(?:source-rss|source-feed)">([^<]+)<\/podcast:txt>/);
      
      if (!rssMatch) {
        throw new Error(`No source RSS URL found in playlist: ${playlistId}`);
      }

      const rssUrl = rssMatch[1];
      console.log(`📡 Source RSS: ${rssUrl}`);
      
      // Parse the RSS feed
      const feed = await this.parser.parseURL(rssUrl);
      
      console.log(`📊 Parsed RSS feed: ${feed.title}`);

      // Extract existing remote items from playlist
      const existingRemoteItems = this.extractExistingRemoteItems(playlistContent);
      console.log(`📋 Existing remote items: ${existingRemoteItems.length}`);

      // Extract podcast:remoteItem entries from feed (like Auto-musicL-Maker does)
      const existingRemoteItemsFromFeed = await this.extractRemoteItemsFromFeed(rssUrl);
      console.log(`🎵 Found ${existingRemoteItemsFromFeed.length} existing remote items in feed`);

      // Auto-musicL-Maker approach: Use existing remote items if found, otherwise convert RSS items
      let feedRemoteItems = existingRemoteItemsFromFeed;
      
      if (feedRemoteItems.length === 0) {
        console.log(`📡 No existing remote items found, converting RSS items to remote items`);
        const feedItems = feed.items || [];
        
        if (feedItems.length === 0) {
          throw new Error(`No items found in RSS feed: ${rssUrl}`);
        }

        // Get the feed GUID for remote items (use actual feed GUID, not generated)
        const feedGuid = feed.guid || this.generateGUID();
        console.log(`📋 Feed's actual GUID: ${feed.guid || 'none'}`);
        console.log(`📋 Using feed GUID: ${feedGuid}`);

        // Convert RSS items to remote items (Auto-musicL-Maker fallback approach)
        feedRemoteItems = feedItems.map(item => ({
          feedGuid: feedGuid,
          itemGuid: item.guid || item.link
        }));
      } else {
        console.log(`✅ Using existing remote items from feed (Auto-musicL-Maker approach)`);
      }

      // Replace all existing remote items with new ones from the feed
      console.log(`🔄 Replacing ${existingRemoteItems.length} existing remote items with ${feedRemoteItems.length} from feed`);

      // Generate new remote items for all items from feed
      const newRemoteItemXML = feedRemoteItems.map(item => {
        return `      <podcast:remoteItem feedGuid="${item.feedGuid}" itemGuid="${item.itemGuid}"/>`;
      });

      // Update the playlist by replacing all remote items
      let updatedPlaylistContent = this.replaceAllRemoteItems(
        playlistContent, 
        newRemoteItemXML
      );

      // Update podcast:txt tag to use source-feed purpose (matching Auto-musicL-Maker)
      updatedPlaylistContent = this.updatePodcastTxtTag(updatedPlaylistContent, rssUrl);

      // Update pubDate and lastBuildDate to current time
      updatedPlaylistContent = this.updateTimestamps(updatedPlaylistContent);

      // Write the updated playlist
      writeFileSync(playlistPath, updatedPlaylistContent, 'utf8');
      
      console.log(`✅ Successfully updated ${playlistId}`);
      console.log(`📁 Local path: ${playlistPath}`);
      console.log(`🔄 Replaced ${existingRemoteItems.length} old remote items with ${feedRemoteItems.length} new ones`);
      console.log(`📊 Total remote items: ${feedRemoteItems.length}`);
      
      // Show first few remote items
      feedRemoteItems.slice(0, 5).forEach((item, index) => {
        console.log(`  ${index + 1}. feedGuid: ${item.feedGuid}, itemGuid: ${item.itemGuid}`);
      });
      if (feedRemoteItems.length > 5) {
        console.log(`  ... and ${feedRemoteItems.length - 5} more`);
      }
      
      return { 
        success: true, 
        playlistPath,
        newEpisodesCount: feedRemoteItems.length,
        totalEpisodes: feedRemoteItems.length,
        replacedItems: true,
        newRemoteItems: feedRemoteItems
      };

    } catch (error) {
      console.error(`❌ Error updating ${playlistId}:`, error.message);
      throw error;
    }
  }

  extractExistingRemoteItems(playlistContent) {
    const remoteItemMatches = playlistContent.matchAll(/<podcast:remoteItem[^>]*itemGuid="([^"]+)"[^>]*feedGuid="([^"]+)"[^>]*\/>/g);
    return Array.from(remoteItemMatches).map(match => ({
      itemGuid: match[1],
      feedGuid: match[2],
      fullMatch: match[0]
    }));
  }


  replaceAllRemoteItems(playlistContent, newRemoteItems) {
    // Find the position after the last channel metadata
    const channelEndMatch = playlistContent.match(/(<podcast:guid>[^<]+<\/podcast:guid>)/);
    
    if (!channelEndMatch) {
      throw new Error('Could not find podcast:guid tag to replace items');
    }

    const insertPosition = channelEndMatch.index + channelEndMatch[0].length;
    
    // Find the position before the closing channel tag
    const channelEndTag = playlistContent.indexOf('</channel>');
    
    if (channelEndTag === -1) {
      throw new Error('Could not find closing channel tag');
    }
    
    // Replace all content between channel metadata and closing channel tag
    const beforeInsert = playlistContent.substring(0, insertPosition);
    const afterInsert = playlistContent.substring(channelEndTag);
    
    return beforeInsert + '\n' + newRemoteItems.join('\n') + '\n  ' + afterInsert;
  }

  async extractRemoteItemsFromFeed(feedUrl) {
    try {
      // Fetch raw RSS XML to parse remote items directly
      const response = await fetch(feedUrl);
      const rssXml = await response.text();
      
      // Extract all remote items from the raw XML (handle both single and double quotes)
      const remoteItems = [];
      
      // Pattern 1: feedGuid first, itemGuid second (double quotes)
      const pattern1Matches = rssXml.matchAll(/<podcast:remoteItem[^>]*feedGuid="([^"]+)"[^>]*itemGuid="([^"]+)"[^>]*\/?>/g);
      for (const match of pattern1Matches) {
        remoteItems.push({
          feedGuid: match[1],
          itemGuid: match[2]
        });
      }
      
      // Pattern 2: itemGuid first, feedGuid second (double quotes) 
      const pattern2Matches = rssXml.matchAll(/<podcast:remoteItem[^>]*itemGuid="([^"]+)"[^>]*feedGuid="([^"]+)"[^>]*\/?>/g);
      for (const match of pattern2Matches) {
        remoteItems.push({
          feedGuid: match[2],
          itemGuid: match[1]
        });
      }
      
      // Pattern 3: feedGuid first, itemGuid second (single quotes)
      const pattern3Matches = rssXml.matchAll(/<podcast:remoteItem[^>]*feedGuid='([^']+)'[^>]*itemGuid='([^']+)'[^>]*\/?>/g);
      for (const match of pattern3Matches) {
        remoteItems.push({
          feedGuid: match[1],
          itemGuid: match[2]
        });
      }
      
      // Pattern 4: itemGuid first, feedGuid second (single quotes)
      const pattern4Matches = rssXml.matchAll(/<podcast:remoteItem[^>]*itemGuid='([^']+)'[^>]*feedGuid='([^']+)'[^>]*\/?>/g);
      for (const match of pattern4Matches) {
        remoteItems.push({
          feedGuid: match[2],
          itemGuid: match[1]
        });
      }
      
      return remoteItems;
    } catch (error) {
      console.error('Error extracting remote items from raw XML:', error.message);
      return [];
    }
  }

  updatePodcastTxtTag(playlistContent, rssUrl) {
    // Update podcast:txt tag to use source-feed purpose (matching Auto-musicL-Maker)
    const updatedContent = playlistContent.replace(
      /<podcast:txt purpose="(?:source-rss|source-feed)">([^<]+)<\/podcast:txt>/,
      `<podcast:txt purpose="source-feed">${rssUrl}</podcast:txt>`
    );
    
    return updatedContent;
  }

  updateTimestamps(playlistContent) {
    const currentDate = new Date().toUTCString();
    
    // Only update pubDate - lastBuildDate should remain unchanged as original creation date
    const updatedContent = playlistContent.replace(
      /<pubDate>[^<]+<\/pubDate>/,
      `<pubDate>${currentDate}</pubDate>`
    );
    
    return updatedContent;
  }

  generateGUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async updateAllPlaylists() {
    const playlistFiles = [
      'ITDV-music-playlist',
      'HGH-music-playlist', 
      'MMT-muic-playlist',
      'flowgnar-music-playlist',
      'upbeats-music-playlist',
      'SAS-music-playlist',
      'IAM-music-playlist',
      'MMM-music-playlist',
      'b4ts-music-playlist'
    ];

    const results = [];
    
    for (const playlistId of playlistFiles) {
      try {
        console.log(`\n🔄 Updating ${playlistId}...`);
        const result = await this.updatePlaylist(playlistId);
        results.push({ playlistId, ...result });
      } catch (error) {
        console.error(`❌ Failed to update ${playlistId}:`, error.message);
        results.push({ playlistId, success: false, error: error.message });
      }
    }

    // Summary
    console.log(`\n📊 Update Summary:`);
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Successful: ${successful.length}`);
    console.log(`❌ Failed: ${failed.length}`);
    
    successful.forEach(result => {
      console.log(`  ${result.playlistId}: +${result.newEpisodesCount} episodes (${result.totalEpisodes} total)`);
    });
    
    if (failed.length > 0) {
      console.log(`\n❌ Failed updates:`);
      failed.forEach(result => {
        console.log(`  ${result.playlistId}: ${result.error}`);
      });
    }

    return results;
  }
}

// CLI interface
async function main() {
  const updater = new MusicPlaylistUpdater();
  const command = process.argv[2];
  const playlistId = process.argv[3];

  switch (command) {
    case 'update':
      if (playlistId) {
        await updater.updatePlaylist(playlistId);
      } else {
        console.log('❌ Please specify a playlist ID');
        console.log('Usage: node music-playlist-updater.js update <playlist-id>');
        console.log('\nAvailable playlists:');
        console.log('  • ITDV-music-playlist (Into The Doerfel-Verse)');
        console.log('  • HGH-music-playlist (Homegrown Hits)');
        console.log('  • MMT-muic-playlist (Mike\'s Mix Tape)');
        console.log('  • flowgnar-music-playlist (Flowgnar)');
        console.log('  • upbeats-music-playlist (UpBEATs)');
        console.log('  • SAS-music-playlist (Sats and Sounds)');
        console.log('  • IAM-music-playlist (It\'s A Mood)');
        console.log('  • MMM-music-playlist (Mutton, Mead & Music)');
        console.log('  • b4ts-music-playlist (Behind The Sch3m3s)');
      }
      break;
      
    case 'update-all':
      await updater.updateAllPlaylists();
      break;
      
    default:
      console.log(`
🔄 Music Playlist Updater

Usage: node music-playlist-updater.js <command> [playlist-id]

Commands:
  update <playlist-id>           Update a specific playlist with new episodes
  update-all                    Update all playlists with new episodes

Examples:
  node music-playlist-updater.js update ITDV-music-playlist
  node music-playlist-updater.js update-all

This tool adds new podcast:remoteItem entries to existing music playlists
when new episodes are released, preserving all existing episodes.
      `);
      break;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });
}

export { MusicPlaylistUpdater };
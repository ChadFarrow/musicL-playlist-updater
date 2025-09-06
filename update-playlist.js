#!/usr/bin/env node

import { RSSPlaylistGenerator } from './src/services/RSSPlaylistGenerator.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

class PlaylistUpdater {
  constructor(config = {}) {
    this.config = {
      playlistsDir: './playlists',
      enableGitHubSync: false,
      ...config
    };
    this.generator = new RSSPlaylistGenerator(this.config);
  }

  async updatePlaylist(playlistId) {
    try {
      console.log(`🔄 Updating playlist: ${playlistId}`);
      
      // Read the existing playlist to get the RSS URL
      const playlistPath = join(this.config.playlistsDir, `${playlistId}.xml`);
      
      if (!existsSync(playlistPath)) {
        throw new Error(`Playlist not found: ${playlistPath}`);
      }

      const playlistContent = readFileSync(playlistPath, 'utf8');
      
      // Extract RSS URL from podcast:txt tag
      const rssMatch = playlistContent.match(/<podcast:txt purpose="source-rss">([^<]+)<\/podcast:txt>/);
      
      if (!rssMatch) {
        throw new Error(`No source RSS URL found in playlist: ${playlistId}`);
      }

      const rssUrl = rssMatch[1];
      console.log(`📡 Source RSS: ${rssUrl}`);

      // Extract playlist metadata
      const titleMatch = playlistContent.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/);
      const descriptionMatch = playlistContent.match(/<description><!\[CDATA\[([^\]]+)\]\]><\/description>/);
      const authorMatch = playlistContent.match(/<managingEditor>([^<]+)<\/managingEditor>/);
      const imageMatch = playlistContent.match(/<url>([^<]+)<\/url>/);

      const feedConfig = {
        name: `${playlistId} Feed`,
        rssUrl: rssUrl,
        playlistId: playlistId,
        playlistTitle: titleMatch ? titleMatch[1] : playlistId,
        playlistDescription: descriptionMatch ? descriptionMatch[1] : `Updated playlist: ${playlistId}`,
        playlistAuthor: authorMatch ? authorMatch[1] : 'ChadFarrow',
        playlistImageUrl: imageMatch ? imageMatch[1] : ''
      };

      console.log(`📝 Playlist Title: ${feedConfig.playlistTitle}`);
      console.log(`👤 Author: ${feedConfig.playlistAuthor}`);

      // Generate updated playlist
      const result = await this.generator.generatePlaylistFromRSS(feedConfig);
      
      if (result.success) {
        console.log(`✅ Successfully updated ${playlistId}`);
        console.log(`📊 Episodes: ${result.episodeCount}`);
        console.log(`📁 Local path: ${result.localPath}`);
        
        if (result.lastEpisode) {
          console.log(`🎵 Latest episode: ${result.lastEpisode.title}`);
          console.log(`📅 Published: ${result.lastEpisode.pubDate}`);
        }
        
        return result;
      } else {
        throw new Error(`Failed to generate playlist: ${result.error}`);
      }

    } catch (error) {
      console.error(`❌ Error updating ${playlistId}:`, error.message);
      throw error;
    }
  }

  async updateAllPlaylists() {
    try {
      const fs = await import('fs');
      const files = fs.readdirSync(this.config.playlistsDir);
      const xmlFiles = files.filter(file => file.endsWith('.xml'));

      console.log(`📊 Found ${xmlFiles.length} playlists to update:`);
      xmlFiles.forEach(file => console.log(`  • ${file}`));

      const results = [];
      
      for (const file of xmlFiles) {
        const playlistId = file.replace('.xml', '');
        
        try {
          console.log(`\n🔄 Updating: ${playlistId}`);
          const result = await this.updatePlaylist(playlistId);
          results.push({ playlistId, success: true, result });
        } catch (error) {
          console.error(`❌ Failed to update ${playlistId}:`, error.message);
          results.push({ playlistId, success: false, error: error.message });
        }
      }

      // Summary
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      console.log('\n📊 Update Summary:');
      console.log(`✅ Successful: ${successful}`);
      console.log(`❌ Failed: ${failed}`);

      if (successful > 0) {
        console.log('\n🎉 Successfully updated playlists:');
        results.filter(r => r.success).forEach(result => {
          console.log(`  • ${result.playlistId} - ${result.result.episodeCount} episodes`);
        });
      }

      return results;

    } catch (error) {
      console.error('❌ Error updating playlists:', error.message);
      throw error;
    }
  }

  async checkPlaylistStatus(playlistId) {
    try {
      const playlistPath = join(this.config.playlistsDir, `${playlistId}.xml`);
      
      if (!existsSync(playlistPath)) {
        throw new Error(`Playlist not found: ${playlistPath}`);
      }

      const playlistContent = readFileSync(playlistPath, 'utf8');
      
      // Extract metadata
      const titleMatch = playlistContent.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/);
      const pubDateMatch = playlistContent.match(/<pubDate>([^<]+)<\/pubDate>/);
      const lastBuildMatch = playlistContent.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/);
      const rssMatch = playlistContent.match(/<podcast:txt purpose="source-rss">([^<]+)<\/podcast:txt>/);
      
      // Count items
      const itemMatches = playlistContent.match(/<item>/g);
      const itemCount = itemMatches ? itemMatches.length : 0;

      const status = {
        playlistId,
        title: titleMatch ? titleMatch[1] : playlistId,
        pubDate: pubDateMatch ? pubDateMatch[1] : 'Unknown',
        lastBuildDate: lastBuildMatch ? lastBuildMatch[1] : 'Unknown',
        itemCount,
        rssUrl: rssMatch ? rssMatch[1] : 'Not found',
        fileSize: playlistContent.length
      };

      return status;

    } catch (error) {
      console.error(`❌ Error checking status of ${playlistId}:`, error.message);
      throw error;
    }
  }
}

// CLI interface
async function main() {
  const updater = new PlaylistUpdater();
  const command = process.argv[2];
  const playlistId = process.argv[3];

  switch (command) {
    case 'update':
      if (playlistId) {
        await updater.updatePlaylist(playlistId);
      } else {
        console.log('❌ Please specify a playlist ID');
        console.log('Usage: node update-playlist.js update <playlist-id>');
      }
      break;
      
    case 'update-all':
      await updater.updateAllPlaylists();
      break;
      
    case 'status':
      if (playlistId) {
        const status = await updater.checkPlaylistStatus(playlistId);
        console.log('\n📊 Playlist Status:');
        console.log(`Title: ${status.title}`);
        console.log(`Published: ${status.pubDate}`);
        console.log(`Last Build: ${status.lastBuildDate}`);
        console.log(`Items: ${status.itemCount}`);
        console.log(`RSS URL: ${status.rssUrl}`);
        console.log(`File Size: ${status.fileSize} characters`);
      } else {
        console.log('❌ Please specify a playlist ID');
        console.log('Usage: node update-playlist.js status <playlist-id>');
      }
      break;
      
    default:
      console.log(`
🔄 Playlist Updater

Usage: node update-playlist.js <command> [playlist-id]

Commands:
  update <playlist-id>    Update a specific playlist
  update-all             Update all playlists
  status <playlist-id>   Check status of a playlist

Examples:
  node update-playlist.js update ITDV-music-playlist
  node update-playlist.js update-all
  node update-playlist.js status ITDV-music-playlist

This tool updates playlists by fetching fresh content from their source RSS feeds.
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

export { PlaylistUpdater };

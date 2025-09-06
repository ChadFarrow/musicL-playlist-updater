#!/usr/bin/env node

import Parser from 'rss-parser';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

class MusicPlaylistBuilder {
  constructor(config = {}) {
    this.config = {
      playlistsDir: './playlists',
      ...config
    };
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
  }

  async buildMusicPlaylist(playlistId, rssUrl, playlistConfig = {}) {
    try {
      console.log(`🎵 Building music playlist: ${playlistId}`);
      console.log(`📡 Source RSS: ${rssUrl}`);
      
      // Parse the RSS feed
      const feed = await this.parser.parseURL(rssUrl);
      
      if (!feed.items || feed.items.length === 0) {
        throw new Error(`No items found in RSS feed: ${rssUrl}`);
      }

      console.log(`📊 Found ${feed.items.length} episodes in RSS feed`);

      // Generate feed GUID
      const feedGuid = feed.guid || this.generateGUID();
      
      // Generate remote items for all episodes
      const remoteItems = feed.items.map(episode => {
        const itemGuid = episode.guid || episode.link;
        return `      <podcast:remoteItem feedGuid="${feedGuid}" itemGuid="${itemGuid}"/>`;
      });

      console.log(`🎵 Generated ${remoteItems.length} remote items`);

      // Build the music playlist XML
      const playlistXML = this.generateMusicPlaylistXML(
        playlistId, 
        rssUrl, 
        remoteItems, 
        playlistConfig,
        feed
      );

      // Write the playlist file
      const playlistPath = join(this.config.playlistsDir, `${playlistId}.xml`);
      writeFileSync(playlistPath, playlistXML, 'utf8');
      
      console.log(`✅ Successfully built ${playlistId}`);
      console.log(`📁 Local path: ${playlistPath}`);
      console.log(`📊 Remote items: ${remoteItems.length}`);
      
      return { 
        success: true, 
        playlistPath,
        remoteItemCount: remoteItems.length,
        feedTitle: feed.title,
        latestEpisode: feed.items[0] ? {
          title: feed.items[0].title,
          pubDate: feed.items[0].pubDate
        } : null
      };

    } catch (error) {
      console.error(`❌ Error building ${playlistId}:`, error.message);
      throw error;
    }
  }

  generateMusicPlaylistXML(playlistId, rssUrl, remoteItems, playlistConfig, feed) {
    const now = new Date().toUTCString();
    const guid = this.generateGUID();
    
    // Default playlist configuration
    const config = {
      title: playlistConfig.title || `${playlistId} music playlist`,
      description: playlistConfig.description || `Music playlist from ${feed.title || 'RSS feed'}`,
      author: playlistConfig.author || 'ChadFarrow',
      link: playlistConfig.link || feed.link || rssUrl,
      imageUrl: playlistConfig.imageUrl || '',
      ...playlistConfig
    };

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <author>${config.author}</author>
    <title>${config.title}</title>
    <description>${config.description}</description>
    <link>${config.link}</link>
    <podcast:txt purpose="source-rss">${rssUrl}</podcast:txt>
    <language>en</language>
    <pubDate>${now}</pubDate>
    <lastBuildDate>${now}</lastBuildDate>
    <image>
      <url>${config.imageUrl}</url>
    </image>
    <podcast:medium>musicL</podcast:medium>
    <podcast:guid>${guid}</podcast:guid>
${remoteItems.join('\n')}
  </channel>
</rss>`;
  }

  generateGUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async buildFromExistingPlaylist(playlistId) {
    try {
      console.log(`🔄 Building from existing playlist: ${playlistId}`);
      
      // Read the existing playlist to get RSS URL and config
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
      
      // Extract existing configuration
      const titleMatch = playlistContent.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<title>([^<]+)<\/title>/);
      const descriptionMatch = playlistContent.match(/<description><!\[CDATA\[([^\]]+)\]\]><\/description>|<description>([^<]+)<\/description>/);
      const authorMatch = playlistContent.match(/<author>([^<]+)<\/author>/);
      const linkMatch = playlistContent.match(/<link>([^<]+)<\/link>/);
      const imageMatch = playlistContent.match(/<url>([^<]+)<\/url>/);

      const playlistConfig = {
        title: titleMatch ? (titleMatch[1] || titleMatch[2]) : `${playlistId} music playlist`,
        description: descriptionMatch ? (descriptionMatch[1] || descriptionMatch[2]) : `Music playlist from ${playlistId}`,
        author: authorMatch ? authorMatch[1] : 'ChadFarrow',
        link: linkMatch ? linkMatch[1] : rssUrl,
        imageUrl: imageMatch ? imageMatch[1] : ''
      };

      // Build fresh playlist from RSS
      return await this.buildMusicPlaylist(playlistId, rssUrl, playlistConfig);

    } catch (error) {
      console.error(`❌ Error building from existing playlist ${playlistId}:`, error.message);
      throw error;
    }
  }
}

// CLI interface
async function main() {
  const builder = new MusicPlaylistBuilder();
  const command = process.argv[2];
  const playlistId = process.argv[3];
  const rssUrl = process.argv[4];

  switch (command) {
    case 'build':
      if (playlistId && rssUrl) {
        await builder.buildMusicPlaylist(playlistId, rssUrl);
      } else {
        console.log('❌ Please specify playlist ID and RSS URL');
        console.log('Usage: node build-music-playlist.js build <playlist-id> <rss-url>');
      }
      break;
      
    case 'rebuild':
      if (playlistId) {
        await builder.buildFromExistingPlaylist(playlistId);
      } else {
        console.log('❌ Please specify a playlist ID');
        console.log('Usage: node build-music-playlist.js rebuild <playlist-id>');
      }
      break;
      
    default:
      console.log(`
🎵 Music Playlist Builder

Usage: node build-music-playlist.js <command> [playlist-id] [rss-url]

Commands:
  build <playlist-id> <rss-url>    Build a new music playlist from RSS feed
  rebuild <playlist-id>           Rebuild existing playlist from its RSS feed

Examples:
  node build-music-playlist.js build ITDV-music-playlist https://www.doerfelverse.com/feeds/intothedoerfelverse.xml
  node build-music-playlist.js rebuild ITDV-music-playlist

This tool builds music playlists with podcast:remoteItem entries from RSS feeds.
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

export { MusicPlaylistBuilder };

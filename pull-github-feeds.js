#!/usr/bin/env node

import axios from 'axios';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

class GitHubFeedPuller {
  constructor() {
    this.githubApiUrl = 'https://api.github.com/repos/ChadFarrow/chadf-musicl-playlists/contents/docs';
    this.githubRawUrl = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs';
    this.localPlaylistsDir = './playlists';
  }

  async pullAllFeeds() {
    console.log('📥 Pulling all XML feeds from GitHub repository...\n');

    try {
      // Ensure local directory exists
      this.ensureDirectoryExists(this.localPlaylistsDir);

      // Get list of files from GitHub
      const files = await this.getGitHubFiles();
      
      // Filter for XML files
      const xmlFiles = files.filter(file => 
        file.name.endsWith('.xml') && 
        file.type === 'file'
      );

      console.log(`📊 Found ${xmlFiles.length} XML playlist files:`);
      xmlFiles.forEach(file => {
        console.log(`  • ${file.name}`);
      });

      console.log('\n📥 Downloading playlists...\n');

      // Download each XML file
      const results = [];
      for (const file of xmlFiles) {
        try {
          const result = await this.downloadPlaylist(file);
          results.push(result);
          console.log(`✅ Downloaded: ${file.name}`);
        } catch (error) {
          console.error(`❌ Failed to download ${file.name}:`, error.message);
          results.push({ file: file.name, success: false, error: error.message });
        }
      }

      // Summary
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      console.log('\n📊 Download Summary:');
      console.log(`✅ Successful: ${successful}`);
      console.log(`❌ Failed: ${failed}`);
      console.log(`📁 Local directory: ${this.localPlaylistsDir}`);

      if (successful > 0) {
        console.log('\n🎉 Playlists downloaded successfully!');
        console.log('💡 You can now work with the actual playlists from your repository.');
      }

      return results;

    } catch (error) {
      console.error('❌ Error pulling feeds from GitHub:', error.message);
      throw error;
    }
  }

  async getGitHubFiles() {
    try {
      const response = await axios.get(this.githubApiUrl, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'musicl-playlist-updater'
        }
      });

      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Repository or docs folder not found');
      }
      throw error;
    }
  }

  async downloadPlaylist(file) {
    try {
      const rawUrl = `${this.githubRawUrl}/${file.name}`;
      
      const response = await axios.get(rawUrl, {
        headers: {
          'Accept': 'application/xml, text/xml, */*',
          'User-Agent': 'musicl-playlist-updater'
        },
        timeout: 10000
      });

      const localPath = join(this.localPlaylistsDir, file.name);
      writeFileSync(localPath, response.data, 'utf8');

      return {
        file: file.name,
        success: true,
        localPath,
        size: response.data.length,
        lastModified: file.updated_at
      };

    } catch (error) {
      return {
        file: file.name,
        success: false,
        error: error.message
      };
    }
  }

  ensureDirectoryExists(dir) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory: ${dir}`);
    }
  }

  async analyzePlaylists() {
    console.log('\n🔍 Analyzing downloaded playlists...\n');

    try {
      const fs = await import('fs');
      const files = fs.readdirSync(this.localPlaylistsDir);
      const xmlFiles = files.filter(file => file.endsWith('.xml'));

      console.log(`📊 Found ${xmlFiles.length} local playlist files:`);

      for (const file of xmlFiles) {
        try {
          const filePath = join(this.localPlaylistsDir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          
          // Parse basic info
          const titleMatch = content.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/);
          const itemMatches = content.match(/<item>/g);
          const itemCount = itemMatches ? itemMatches.length : 0;
          
          const title = titleMatch ? titleMatch[1] : file.replace('.xml', '');
          
          console.log(`  • ${file}`);
          console.log(`    Title: ${title}`);
          console.log(`    Items: ${itemCount}`);
          console.log(`    Size: ${content.length} characters`);
          console.log('');

        } catch (error) {
          console.error(`❌ Error analyzing ${file}:`, error.message);
        }
      }

    } catch (error) {
      console.error('❌ Error analyzing playlists:', error.message);
    }
  }

  async createFeedConfigs() {
    console.log('\n⚙️ Creating feed configurations...\n');

    try {
      const fs = await import('fs');
      const files = fs.readdirSync(this.localPlaylistsDir);
      const xmlFiles = files.filter(file => file.endsWith('.xml'));

      const feedConfigs = [];

      for (const file of xmlFiles) {
        try {
          const filePath = join(this.localPlaylistsDir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          
          // Parse playlist info
          const titleMatch = content.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/);
          const descriptionMatch = content.match(/<description><!\[CDATA\[([^\]]+)\]\]><\/description>/);
          const authorMatch = content.match(/<managingEditor>([^<]+)<\/managingEditor>/);
          const imageMatch = content.match(/<url>([^<]+)<\/url>/);
          
          const playlistId = file.replace('.xml', '');
          const title = titleMatch ? titleMatch[1] : playlistId;
          const description = descriptionMatch ? descriptionMatch[1] : `Playlist: ${title}`;
          const author = authorMatch ? authorMatch[1] : 'ChadFarrow';
          const imageUrl = imageMatch ? imageMatch[1] : '';

          // Create RSS feed config (assuming these are generated from RSS feeds)
          const feedConfig = {
            id: `${playlistId}-feed`,
            name: `${title} RSS Feed`,
            rssUrl: `https://feed.example.com/${playlistId}.xml`, // You'll need to update these
            playlistId: playlistId,
            playlistTitle: title,
            playlistDescription: description,
            playlistAuthor: author,
            playlistImageUrl: imageUrl,
            enabled: false, // Disabled by default for safety
            lastChecked: null,
            lastEpisodeGuid: null,
            checkIntervalMinutes: 30
          };

          feedConfigs.push(feedConfig);

        } catch (error) {
          console.error(`❌ Error creating config for ${file}:`, error.message);
        }
      }

      // Save feed configurations
      const configData = {
        rssFeeds: feedConfigs,
        playlists: [],
        settings: {
          defaultCheckInterval: 30,
          maxRetries: 3,
          retryDelayMs: 5000,
          enableGitHubSync: false,
          enableNotifications: false,
          monitorMode: 'rss-to-playlist',
          pulledFromGitHub: new Date().toISOString()
        }
      };

      writeFileSync('./src/config/feeds-from-github.json', JSON.stringify(configData, null, 2));
      
      console.log(`✅ Created feed configurations for ${feedConfigs.length} playlists`);
      console.log('📄 Saved to: src/config/feeds-from-github.json');
      console.log('\n⚠️  Note: RSS URLs need to be updated with actual feed URLs');
      console.log('💡 All feeds are disabled by default for safety');

      return feedConfigs;

    } catch (error) {
      console.error('❌ Error creating feed configs:', error.message);
      throw error;
    }
  }
}

// CLI interface
async function main() {
  const puller = new GitHubFeedPuller();
  const command = process.argv[2];

  switch (command) {
    case 'pull':
      await puller.pullAllFeeds();
      break;
      
    case 'analyze':
      await puller.analyzePlaylists();
      break;
      
    case 'config':
      await puller.createFeedConfigs();
      break;
      
    case 'all':
      await puller.pullAllFeeds();
      await puller.analyzePlaylists();
      await puller.createFeedConfigs();
      break;
      
    default:
      console.log(`
📥 GitHub Feed Puller

Usage: node pull-github-feeds.js <command>

Commands:
  pull      Download all XML playlists from GitHub
  analyze   Analyze downloaded playlists
  config    Create feed configurations
  all       Pull, analyze, and create configs

Examples:
  node pull-github-feeds.js pull
  node pull-github-feeds.js all

This tool downloads all XML playlist files from your GitHub repository
so you can work with the actual playlists locally.
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

export { GitHubFeedPuller };

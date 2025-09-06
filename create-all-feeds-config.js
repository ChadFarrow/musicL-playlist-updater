#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

console.log('⚙️ Creating feed configurations for all downloaded playlists...\n');

const playlistsDir = './playlists';

try {
  // Read all XML files
  const fs = await import('fs');
  const files = fs.readdirSync(playlistsDir);
  const xmlFiles = files.filter(file => file.endsWith('.xml'));

  console.log(`📊 Found ${xmlFiles.length} playlist files:`);

  const feedConfigs = [];

  for (const file of xmlFiles) {
    try {
      const filePath = join(playlistsDir, file);
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

      console.log(`  • ${file}`);
      console.log(`    Title: ${title}`);
      console.log(`    Author: ${author}`);
      console.log(`    Description: ${description.substring(0, 50)}...`);
      console.log('');

      // Create RSS feed config
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
      console.error(`❌ Error processing ${file}:`, error.message);
    }
  }

  // Create comprehensive configuration
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
      pulledFromGitHub: new Date().toISOString(),
      totalPlaylists: feedConfigs.length
    }
  };

  // Save configuration
  writeFileSync('./src/config/feeds-all-playlists.json', JSON.stringify(configData, null, 2));
  
  console.log(`✅ Created feed configurations for ${feedConfigs.length} playlists`);
  console.log('📄 Saved to: src/config/feeds-all-playlists.json');
  console.log('\n⚠️  Important Notes:');
  console.log('  • All feeds are DISABLED by default for safety');
  console.log('  • RSS URLs need to be updated with actual feed URLs');
  console.log('  • GitHub sync is DISABLED');
  console.log('\n💡 Next Steps:');
  console.log('  1. Update RSS URLs in the config file');
  console.log('  2. Enable specific feeds you want to monitor');
  console.log('  3. Add your GitHub token when ready');
  console.log('  4. Start monitoring');

  // Show the configuration structure
  console.log('\n📋 Generated Feed Configurations:');
  feedConfigs.forEach(config => {
    console.log(`  • ${config.name}`);
    console.log(`    Playlist ID: ${config.playlistId}`);
    console.log(`    RSS URL: ${config.rssUrl} (needs update)`);
    console.log(`    Enabled: ${config.enabled}`);
    console.log('');
  });

} catch (error) {
  console.error('❌ Error creating feed configs:', error.message);
  process.exit(1);
}

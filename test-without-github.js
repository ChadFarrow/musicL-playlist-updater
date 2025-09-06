#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

console.log('🧪 Testing with repository structure (no GitHub changes)...\n');

try {
  // Create local directories that match your repo structure
  const directories = [
    './playlists',
    './data',
    './logs'
  ];

  directories.forEach(dir => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`📁 Created: ${dir}`);
    } else {
      console.log(`📁 Exists: ${dir}`);
    }
  });

  // Use production config but disable GitHub sync
  const prodConfig = {
    "github": {
      "token": "",
      "repoOwner": "ChadFarrow",
      "repoName": "chadf-musicl-playlists",
      "repoBranch": "main",
      "enableSync": false
    },
    "monitoring": {
      "checkIntervalMinutes": 5,
      "maxRetries": 3,
      "retryDelayMs": 5000
    },
    "storage": {
      "playlistsDir": "./playlists",
      "dataDir": "./data"
    },
    "logging": {
      "level": "debug"
    },
    "productionMode": true
  };

  const prodFeeds = {
    "rssFeeds": [
      {
        "id": "homegrown-hits-feed",
        "name": "Homegrown Hits Podcast",
        "rssUrl": "https://feed.homegrownhits.xyz/feed.xml",
        "playlistId": "HGH-music-playlist",
        "playlistTitle": "ChadF Homegrown Hits Music Playlist",
        "playlistDescription": "Curated playlist from Homegrown Hits podcast featuring Value4Value independent artists",
        "playlistAuthor": "ChadFarrow",
        "playlistImageUrl": "https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/HGH-playlist-art.webp",
        "enabled": true,
        "lastChecked": null,
        "lastEpisodeGuid": null,
        "checkIntervalMinutes": 5
      }
    ],
    "playlists": [],
    "settings": {
      "defaultCheckInterval": 5,
      "maxRetries": 3,
      "retryDelayMs": 5000,
      "enableGitHubSync": false,
      "enableNotifications": false,
      "monitorMode": "rss-to-playlist",
      "productionMode": true
    }
  };

  // Backup current configs
  if (existsSync('./config.json')) {
    const config = readFileSync('./config.json', 'utf8');
    writeFileSync('./config-backup.json', config);
    console.log('💾 Backed up: config.json');
  }

  if (existsSync('./src/config/feeds.json')) {
    const feeds = readFileSync('./src/config/feeds.json', 'utf8');
    writeFileSync('./src/config/feeds-backup.json', feeds);
    console.log('💾 Backed up: src/config/feeds.json');
  }

  // Write production configs with GitHub sync disabled
  writeFileSync('./config.json', JSON.stringify(prodConfig, null, 2));
  writeFileSync('./src/config/feeds.json', JSON.stringify(prodFeeds, null, 2));
  
  console.log('🔄 Configured for production structure (GitHub sync DISABLED)');

  console.log('\n✅ Repository structure test setup complete!\n');
  console.log('📁 Production directories:');
  console.log('  - playlists/ (matches your repo structure)');
  console.log('  - data/');
  console.log('  - logs/');
  console.log('\n🔧 Configuration:');
  console.log('  - GitHub sync: DISABLED (safe testing)');
  console.log('  - Check interval: 5 minutes (faster testing)');
  console.log('  - Log level: debug');
  console.log('  - Target playlist: HGH-music-playlist');
  console.log('  - Target repo: ChadFarrow/chadf-musicl-playlists');
  console.log('\n🛡️ SAFETY: No changes will be made to your GitHub repository');
  console.log('\n🚀 Ready for testing with production structure!');
  console.log('\n💡 Commands:');
  console.log('  npm start start     # Start monitoring (safe)');
  console.log('  npm start status    # Check status');
  console.log('  node restore-sandbox.js  # Restore test configs');

} catch (error) {
  console.error('❌ Error setting up repository test:', error.message);
  process.exit(1);
}

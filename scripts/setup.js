#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

console.log('🎵 Setting up MusicL Playlist Updater...\n');

// Create necessary directories
const directories = [
  './logs',
  './playlists',
  './data',
  './src/config'
];

directories.forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`✅ Created directory: ${dir}`);
  } else {
    console.log(`📁 Directory exists: ${dir}`);
  }
});

// Create .env file if it doesn't exist
if (!existsSync('.env')) {
  const envExample = readFileSync('env.example', 'utf8');
  writeFileSync('.env', envExample);
  console.log('✅ Created .env file from template');
  console.log('⚠️  Please edit .env with your actual configuration values');
} else {
  console.log('📄 .env file already exists');
}

// Create initial feeds.json if it doesn't exist
const feedsConfigPath = './src/config/feeds.json';
if (!existsSync(feedsConfigPath)) {
  const initialConfig = {
    "feeds": [],
    "settings": {
      "defaultCheckInterval": 30,
      "maxRetries": 3,
      "retryDelayMs": 5000,
      "enableGitHubSync": true,
      "enableNotifications": true
    }
  };
  
  writeFileSync(feedsConfigPath, JSON.stringify(initialConfig, null, 2));
  console.log('✅ Created initial feeds.json configuration');
} else {
  console.log('📄 feeds.json already exists');
}

console.log('\n🎉 Setup complete!');
console.log('\nNext steps:');
console.log('1. Edit .env with your configuration');
console.log('2. Add your first feed: npm start add-feed "My Podcast" "https://example.com/feed.xml"');
console.log('3. Start monitoring: npm start start');
console.log('\nFor more information, see README.md');

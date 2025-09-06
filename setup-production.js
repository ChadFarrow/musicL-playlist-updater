#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

console.log('🚀 Setting up production environment...\n');

try {
  // Create production directories
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

  // Backup current configs if they exist
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

  // Switch to production configs
  if (existsSync('./config-production.json')) {
    const prodConfig = readFileSync('./config-production.json', 'utf8');
    writeFileSync('./config.json', prodConfig);
    console.log('🔄 Switched to production config');
  }

  if (existsSync('./src/config/feeds-production.json')) {
    const prodFeeds = readFileSync('./src/config/feeds-production.json', 'utf8');
    writeFileSync('./src/config/feeds.json', prodFeeds);
    console.log('🔄 Switched to production feeds');
  }

  console.log('\n✅ Production environment setup complete!\n');
  console.log('📁 Production directories:');
  console.log('  - playlists/');
  console.log('  - data/');
  console.log('  - logs/');
  console.log('\n🔧 Production configuration:');
  console.log('  - GitHub sync: ENABLED (when token added)');
  console.log('  - Check interval: 30 minutes');
  console.log('  - Log level: info');
  console.log('  - Target playlist: HGH-music-playlist');
  console.log('  - Target repo: ChadFarrow/chadf-musicl-playlists');
  console.log('\n⚠️  IMPORTANT: Add your GitHub token to config.json');
  console.log('   Edit config.json and replace "your_github_token_here"');
  console.log('\n🚀 Ready for production!');
  console.log('\n💡 Commands:');
  console.log('  npm start start     # Start production monitoring');
  console.log('  npm start status    # Check production status');
  console.log('  node restore-sandbox.js  # Restore test configs');

} catch (error) {
  console.error('❌ Error setting up production:', error.message);
  process.exit(1);
}

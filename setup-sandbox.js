#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

console.log('🧪 Setting up test sandbox environment...\n');

try {
  // Create test directories
  const directories = [
    './test-playlists',
    './test-data',
    './test-logs'
  ];

  directories.forEach(dir => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`📁 Created: ${dir}`);
    } else {
      console.log(`📁 Exists: ${dir}`);
    }
  });

  // Backup original configs
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

  // Switch to test configs
  if (existsSync('./config-test.json')) {
    const testConfig = readFileSync('./config-test.json', 'utf8');
    writeFileSync('./config.json', testConfig);
    console.log('🔄 Switched to test config');
  }

  if (existsSync('./src/config/feeds-test.json')) {
    const testFeeds = readFileSync('./src/config/feeds-test.json', 'utf8');
    writeFileSync('./src/config/feeds.json', testFeeds);
    console.log('🔄 Switched to test feeds');
  }

  console.log('\n✅ Test sandbox setup complete!\n');
  console.log('📁 Test directories created:');
  console.log('  - test-playlists/');
  console.log('  - test-data/');
  console.log('  - test-logs/');
  console.log('\n🔧 Test configuration:');
  console.log('  - GitHub sync: DISABLED');
  console.log('  - Check interval: 5 minutes');
  console.log('  - Log level: debug');
  console.log('  - Test playlist: HGH-music-playlist-TEST');
  console.log('\n🚀 Ready for testing!');
  console.log('\n💡 Commands:');
  console.log('  npm start start     # Start monitoring (safe)');
  console.log('  npm start status    # Check status');
  console.log('  node restore-sandbox.js  # Restore original configs');

} catch (error) {
  console.error('❌ Error setting up sandbox:', error.message);
  process.exit(1);
}

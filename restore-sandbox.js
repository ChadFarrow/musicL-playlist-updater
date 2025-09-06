#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';

console.log('🔄 Restoring original configurations...\n');

try {
  // Restore original config.json
  if (existsSync('./config-backup.json')) {
    const originalConfig = readFileSync('./config-backup.json', 'utf8');
    writeFileSync('./config.json', originalConfig);
    console.log('✅ Restored: config.json');
  } else {
    console.log('⚠️  No backup found for config.json');
  }

  // Restore original feeds.json
  if (existsSync('./src/config/feeds-backup.json')) {
    const originalFeeds = readFileSync('./src/config/feeds-backup.json', 'utf8');
    writeFileSync('./src/config/feeds.json', originalFeeds);
    console.log('✅ Restored: src/config/feeds.json');
  } else {
    console.log('⚠️  No backup found for src/config/feeds.json');
  }

  console.log('\n🎉 Original configurations restored!');
  console.log('💡 You can now safely run the production system.');
  console.log('\n🚀 Production commands:');
  console.log('  npm start start     # Start production monitoring');
  console.log('  npm start status    # Check production status');

} catch (error) {
  console.error('❌ Error restoring original configs:', error.message);
  process.exit(1);
}

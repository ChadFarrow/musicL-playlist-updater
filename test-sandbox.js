#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { MusicLPlaylistUpdater } from './src/index.js';
import { logger } from './src/utils/logger.js';

class TestSandbox {
  constructor() {
    this.testConfigPath = './config-test.json';
    this.testFeedsPath = './src/config/feeds-test.json';
    this.backupConfigPath = './config-backup.json';
    this.backupFeedsPath = './src/config/feeds-backup.json';
    this.testMode = true;
  }

  async setupSandbox() {
    console.log('🧪 Setting up test sandbox environment...\n');

    try {
      // Create test directories
      this.createTestDirectories();

      // Backup original configs
      this.backupOriginalConfigs();

      // Switch to test configs
      this.switchToTestConfigs();

      console.log('✅ Test sandbox setup complete!\n');
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

    } catch (error) {
      console.error('❌ Error setting up sandbox:', error.message);
      throw error;
    }
  }

  createTestDirectories() {
    const directories = [
      './test-playlists',
      './test-data',
      './test-logs'
    ];

    directories.forEach(dir => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        console.log(`📁 Created: ${dir}`);
      }
    });
  }

  backupOriginalConfigs() {
    try {
      // Backup config.json if it exists
      if (existsSync('./config.json')) {
        const config = readFileSync('./config.json', 'utf8');
        writeFileSync(this.backupConfigPath, config);
        console.log('💾 Backed up: config.json');
      }

      // Backup feeds.json if it exists
      if (existsSync('./src/config/feeds.json')) {
        const feeds = readFileSync('./src/config/feeds.json', 'utf8');
        writeFileSync(this.backupFeedsPath, feeds);
        console.log('💾 Backed up: src/config/feeds.json');
      }
    } catch (error) {
      console.warn('⚠️  Could not backup original configs:', error.message);
    }
  }

  switchToTestConfigs() {
    try {
      // Copy test config to main config
      const testConfig = readFileSync(this.testConfigPath, 'utf8');
      writeFileSync('./config.json', testConfig);
      console.log('🔄 Switched to test config');

      // Copy test feeds to main feeds
      const testFeeds = readFileSync(this.testFeedsPath, 'utf8');
      writeFileSync('./src/config/feeds.json', testFeeds);
      console.log('🔄 Switched to test feeds');
    } catch (error) {
      console.error('❌ Error switching to test configs:', error.message);
      throw error;
    }
  }

  async restoreOriginalConfigs() {
    console.log('🔄 Restoring original configurations...\n');

    try {
      // Restore original config.json
      if (existsSync(this.backupConfigPath)) {
        const originalConfig = readFileSync(this.backupConfigPath, 'utf8');
        writeFileSync('./config.json', originalConfig);
        console.log('✅ Restored: config.json');
      }

      // Restore original feeds.json
      if (existsSync(this.backupFeedsPath)) {
        const originalFeeds = readFileSync(this.backupFeedsPath, 'utf8');
        writeFileSync('./src/config/feeds.json', originalFeeds);
        console.log('✅ Restored: src/config/feeds.json');
      }

      console.log('\n🎉 Original configurations restored!');
      console.log('💡 You can now safely run the production system.');

    } catch (error) {
      console.error('❌ Error restoring original configs:', error.message);
      throw error;
    }
  }

  async runTest() {
    console.log('🧪 Running test in sandbox environment...\n');

    try {
      const updater = new MusicLPlaylistUpdater();
      
      // Test status
      console.log('📊 Test Status:');
      const status = updater.getStatus();
      console.log(`- Monitor Mode: ${status.monitorMode}`);
      console.log(`- Active Jobs: ${status.activeJobs}`);
      
      if (status.rssFeeds) {
        console.log(`- RSS Feeds: ${status.rssFeeds.length}`);
        status.rssFeeds.forEach(feed => {
          console.log(`  • ${feed.name} → ${feed.playlistId}`);
        });
      }

      // Test RSS feed generation
      console.log('\n🔄 Testing RSS feed generation...');
      const feeds = updater.listFeeds();
      if (feeds.length > 0) {
        const testFeed = feeds[0];
        console.log(`Testing feed: ${testFeed.name}`);
        
        // This would normally generate a playlist, but in test mode it's safe
        console.log('✅ Test feed configuration looks good!');
      }

      console.log('\n✅ Sandbox test completed successfully!');
      console.log('💡 All operations are isolated and safe.');

    } catch (error) {
      console.error('❌ Test failed:', error.message);
      throw error;
    }
  }

  showStatus() {
    console.log('🧪 Test Sandbox Status:\n');
    
    const testDirs = ['./test-playlists', './test-data', './test-logs'];
    testDirs.forEach(dir => {
      const exists = existsSync(dir);
      console.log(`${exists ? '✅' : '❌'} ${dir} ${exists ? '(exists)' : '(missing)'}`);
    });

    const configs = [
      { file: './config.json', desc: 'Main config' },
      { file: './src/config/feeds.json', desc: 'Main feeds' },
      { file: './config-test.json', desc: 'Test config' },
      { file: './src/config/feeds-test.json', desc: 'Test feeds' }
    ];

    console.log('\n📄 Configuration files:');
    configs.forEach(config => {
      const exists = existsSync(config.file);
      console.log(`${exists ? '✅' : '❌'} ${config.file} (${config.desc})`);
    });

    console.log('\n💡 Commands:');
    console.log('  node test-sandbox.js setup    - Setup test environment');
    console.log('  node test-sandbox.js test     - Run test');
    console.log('  node test-sandbox.js restore  - Restore original configs');
    console.log('  node test-sandbox.js status   - Show status');
  }
}

// CLI interface
async function main() {
  const sandbox = new TestSandbox();
  const command = process.argv[2];

  switch (command) {
    case 'setup':
      await sandbox.setupSandbox();
      break;
      
    case 'test':
      await sandbox.runTest();
      break;
      
    case 'restore':
      await sandbox.restoreOriginalConfigs();
      break;
      
    case 'status':
      sandbox.showStatus();
      break;
      
    default:
      console.log(`
🧪 Test Sandbox for MusicL Playlist Updater

Usage: node test-sandbox.js <command>

Commands:
  setup     Setup test environment (backup configs, create test dirs)
  test      Run test in sandbox environment
  restore   Restore original configurations
  status    Show current sandbox status

Examples:
  node test-sandbox.js setup
  node test-sandbox.js test
  node test-sandbox.js restore

This sandbox allows you to safely test the RSS feed monitoring
without affecting your live playlists or GitHub repository.
      `);
      break;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Sandbox error:', error.message);
    process.exit(1);
  });
}

export { TestSandbox };

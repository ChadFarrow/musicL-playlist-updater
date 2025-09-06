#!/usr/bin/env node

import { MusicLPlaylistUpdater } from './src/index.js';

async function testSystem() {
  console.log('🎵 Testing MusicL Playlist Updater System\n');
  
  try {
    const updater = new MusicLPlaylistUpdater();
    
    // Test status
    console.log('📊 System Status:');
    const status = updater.getStatus();
    console.log(`- Running: ${status.isRunning}`);
    console.log(`- Monitor Mode: ${status.monitorMode}`);
    console.log(`- Active Jobs: ${status.activeJobs}`);
    
    if (status.playlists) {
      console.log(`- Configured Playlists: ${status.playlists.length}`);
      status.playlists.forEach(playlist => {
        console.log(`  • ${playlist.name} (${playlist.enabled ? 'enabled' : 'disabled'})`);
      });
    }
    
    console.log('\n✅ System test completed successfully!');
    console.log('\n🚀 Ready to start monitoring!');
    console.log('Run: npm start start');
    
  } catch (error) {
    console.error('❌ System test failed:', error.message);
    process.exit(1);
  }
}

testSystem();

#!/usr/bin/env node

import { MusicLPlaylistUpdater } from './src/index.js';

// Example script to add a feed
async function addExampleFeed() {
  const updater = new MusicLPlaylistUpdater();
  
  // Example feed configuration
  const feedConfig = {
    name: "Example Music Podcast",
    rssUrl: "https://example.com/feed.xml", // Replace with actual RSS URL
    playlistId: "example-music-podcast",
    playlistTitle: "Example Music Podcast Playlist",
    playlistDescription: "Auto-updated playlist from Example Music Podcast",
    playlistAuthor: "ChadFarrow",
    playlistImageUrl: "https://example.com/image.jpg", // Optional
    enabled: true,
    checkIntervalMinutes: 30
  };

  try {
    console.log('Adding example feed...');
    const newFeed = await updater.addFeed(feedConfig);
    console.log('✅ Feed added successfully:', newFeed.name);
    console.log('Feed ID:', newFeed.id);
    
    // Test checking the feed
    console.log('\nTesting feed check...');
    const result = await updater.checkFeed(newFeed.id);
    
    if (result.hasNewEpisodes) {
      console.log(`✅ Found ${result.newEpisodes.length} episodes`);
    } else {
      console.log('ℹ️  No new episodes found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  addExampleFeed();
}

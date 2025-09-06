#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

console.log('🔄 Updating MMM playlist with correct RSS feed URL...\n');

const playlistFile = './playlists/MMM-music-playlist.xml';
const correctRSSUrl = 'https://mmmusic-project.ams3.cdn.digitaloceanspaces.com/Mutton_Mead__Music/feed.xml';

try {
  // Read the current playlist
  const content = readFileSync(playlistFile, 'utf8');
  
  console.log('📝 Current RSS URL in playlist:');
  const currentMatch = content.match(/<podcast:txt purpose="source-rss">([^<]+)<\/podcast:txt>/);
  if (currentMatch) {
    console.log(`   ${currentMatch[1]}`);
  }
  
  console.log(`\n🔄 Updating to: ${correctRSSUrl}`);
  
  // Replace the RSS URL
  const updatedContent = content.replace(
    /<podcast:txt purpose="source-rss">[^<]+<\/podcast:txt>/,
    `<podcast:txt purpose="source-rss">${correctRSSUrl}</podcast:txt>`
  );
  
  // Write the updated content
  writeFileSync(playlistFile, updatedContent, 'utf8');
  
  console.log('✅ Successfully updated MMM playlist!');
  
  // Verify the update
  const updatedContentCheck = readFileSync(playlistFile, 'utf8');
  const updatedMatch = updatedContentCheck.match(/<podcast:txt purpose="source-rss">([^<]+)<\/podcast:txt>/);
  if (updatedMatch) {
    console.log(`\n✅ Verified RSS URL: ${updatedMatch[1]}`);
  }
  
  console.log('\n🎉 MMM playlist now references the correct Mutton, Mead & Music RSS feed!');
  
} catch (error) {
  console.error('❌ Error updating MMM playlist:', error.message);
  process.exit(1);
}

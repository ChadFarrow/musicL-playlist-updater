#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

console.log('🔄 Updating b4ts playlist with correct RSS feed URL...\n');

const playlistFile = './playlists/b4ts-music-playlist.xml';
const correctRSSUrl = 'https://music.behindthesch3m3s.com/b4ts%20feed/feed.xml';

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
  
  console.log('✅ Successfully updated b4ts playlist!');
  
  // Verify the update
  const updatedContentCheck = readFileSync(playlistFile, 'utf8');
  const updatedMatch = updatedContentCheck.match(/<podcast:txt purpose="source-rss">([^<]+)<\/podcast:txt>/);
  if (updatedMatch) {
    console.log(`\n✅ Verified RSS URL: ${updatedMatch[1]}`);
  }
  
  console.log('\n🎉 b4ts playlist now references the correct Behind The Sch3m3s RSS feed!');
  
} catch (error) {
  console.error('❌ Error updating b4ts playlist:', error.message);
  process.exit(1);
}

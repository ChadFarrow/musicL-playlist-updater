#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

console.log('🔄 Updating MMT playlist with correct RSS feed URL...\n');

const playlistFile = './playlists/MMT-muic-playlist.xml';
const correctRSSUrl = 'https://mikesmixtape.com/mikesmixtaperss.xml';

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
  
  console.log('✅ Successfully updated MMT playlist!');
  
  // Verify the update
  const updatedContentCheck = readFileSync(playlistFile, 'utf8');
  const updatedMatch = updatedContentCheck.match(/<podcast:txt purpose="source-rss">([^<]+)<\/podcast:txt>/);
  if (updatedMatch) {
    console.log(`\n✅ Verified RSS URL: ${updatedMatch[1]}`);
  }
  
  console.log('\n🎉 MMT playlist now references the correct Mike\'s Mix Tape RSS feed!');
  
} catch (error) {
  console.error('❌ Error updating MMT playlist:', error.message);
  process.exit(1);
}

#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

console.log('🏷️ Adding podcast:txt tags to reference source RSS feeds...\n');

const playlistsDir = './playlists';

// Mapping of playlist IDs to their source RSS feeds
const playlistToRSSMapping = {
  'HGH-music-playlist': 'https://feed.homegrownhits.xyz/feed.xml',
  'IAM-music-playlist': 'https://feed.example.com/IAM-feed.xml', // Update with actual URL
  'ITDV-music-playlist': 'https://feed.example.com/ITDV-feed.xml', // Update with actual URL
  'MMM-music-playlist': 'https://feed.example.com/MMM-feed.xml', // Update with actual URL
  'MMT-muic-playlist': 'https://feed.example.com/MMT-feed.xml', // Update with actual URL
  'SAS-music-playlist': 'https://feed.example.com/SAS-feed.xml', // Update with actual URL
  'b4ts-music-playlist': 'https://feed.example.com/b4ts-feed.xml', // Update with actual URL
  'flowgnar-music-playlist': 'https://feed.example.com/flowgnar-feed.xml', // Update with actual URL
  'upbeats-music-playlist': 'https://feed.example.com/upbeats-feed.xml' // Update with actual URL
};

try {
  // Read all XML files
  const fs = await import('fs');
  const files = fs.readdirSync(playlistsDir);
  const xmlFiles = files.filter(file => file.endsWith('.xml'));

  console.log(`📊 Found ${xmlFiles.length} playlist files to update:`);

  const results = [];

  for (const file of xmlFiles) {
    try {
      const filePath = join(playlistsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      
      const playlistId = file.replace('.xml', '');
      const rssUrl = playlistToRSSMapping[playlistId];
      
      if (!rssUrl) {
        console.log(`⚠️  No RSS URL mapping found for ${playlistId}`);
        continue;
      }

      console.log(`📝 Processing: ${file}`);
      console.log(`   Source RSS: ${rssUrl}`);

      // Check if podcast:txt tag already exists
      const existingTxtTag = content.match(/<podcast:txt[^>]*purpose="source-rss"[^>]*>.*?<\/podcast:txt>/);
      
      if (existingTxtTag) {
        console.log(`   ✅ Already has podcast:txt tag`);
        results.push({ file, status: 'already_exists', rssUrl });
        continue;
      }

      // Create the podcast:txt tag
      const txtTag = `<podcast:txt purpose="source-rss">${rssUrl}</podcast:txt>`;
      
      // Find the best place to insert the tag
      // Look for the channel closing tag and insert before it
      const channelCloseMatch = content.match(/(<\/channel>)/);
      
      if (channelCloseMatch) {
        const updatedContent = content.replace(
          '</channel>',
          `  ${txtTag}\n</channel>`
        );
        
        // Write the updated content
        writeFileSync(filePath, updatedContent, 'utf8');
        
        console.log(`   ✅ Added podcast:txt tag`);
        results.push({ file, status: 'updated', rssUrl });
        
      } else {
        console.log(`   ❌ Could not find channel closing tag`);
        results.push({ file, status: 'error', error: 'No channel closing tag found' });
      }

    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error.message);
      results.push({ file, status: 'error', error: error.message });
    }
  }

  // Summary
  const updated = results.filter(r => r.status === 'updated').length;
  const alreadyExists = results.filter(r => r.status === 'already_exists').length;
  const errors = results.filter(r => r.status === 'error').length;

  console.log('\n📊 Update Summary:');
  console.log(`✅ Updated: ${updated}`);
  console.log(`ℹ️  Already had tag: ${alreadyExists}`);
  console.log(`❌ Errors: ${errors}`);

  if (updated > 0) {
    console.log('\n🎉 Successfully added podcast:txt tags!');
    console.log('\n📋 Updated playlists:');
    results.filter(r => r.status === 'updated').forEach(result => {
      console.log(`  • ${result.file}`);
      console.log(`    Source RSS: ${result.rssUrl}`);
    });
  }

  console.log('\n💡 Next Steps:');
  console.log('  1. Update the RSS URL mappings in this script');
  console.log('  2. Re-run the script to update all playlists');
  console.log('  3. Test the updated playlists');

} catch (error) {
  console.error('❌ Error adding podcast:txt tags:', error.message);
  process.exit(1);
}

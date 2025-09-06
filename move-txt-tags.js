#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

console.log('🔄 Moving podcast:txt tags to appear after <link> tags...\n');

const playlistsDir = './playlists';

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
      
      console.log(`📝 Processing: ${file}`);

      // Find the podcast:txt tag
      const txtTagMatch = content.match(/<podcast:txt purpose="source-rss">([^<]+)<\/podcast:txt>/);
      
      if (!txtTagMatch) {
        console.log(`   ⚠️  No podcast:txt tag found`);
        results.push({ file, status: 'no_tag' });
        continue;
      }

      const txtTag = txtTagMatch[0];
      const rssUrl = txtTagMatch[1];

      // Find the link tag
      const linkMatch = content.match(/<link>([^<]+)<\/link>/);
      
      if (!linkMatch) {
        console.log(`   ⚠️  No <link> tag found`);
        results.push({ file, status: 'no_link' });
        continue;
      }

      const linkTag = linkMatch[0];
      const linkUrl = linkMatch[1];

      console.log(`   Link: ${linkUrl}`);
      console.log(`   RSS: ${rssUrl}`);

      // Remove the existing podcast:txt tag
      let updatedContent = content.replace(txtTag, '');

      // Add the podcast:txt tag right after the link tag
      updatedContent = updatedContent.replace(
        linkTag,
        `${linkTag}\n    ${txtTag}`
      );

      // Write the updated content
      writeFileSync(filePath, updatedContent, 'utf8');
      
      console.log(`   ✅ Moved podcast:txt tag after <link>`);
      results.push({ file, status: 'updated', linkUrl, rssUrl });
      
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error.message);
      results.push({ file, status: 'error', error: error.message });
    }
  }

  // Summary
  const updated = results.filter(r => r.status === 'updated').length;
  const noTag = results.filter(r => r.status === 'no_tag').length;
  const noLink = results.filter(r => r.status === 'no_link').length;
  const errors = results.filter(r => r.status === 'error').length;

  console.log('\n📊 Update Summary:');
  console.log(`✅ Updated: ${updated}`);
  console.log(`⚠️  No tag: ${noTag}`);
  console.log(`⚠️  No link: ${noLink}`);
  console.log(`❌ Errors: ${errors}`);

  if (updated > 0) {
    console.log('\n🎉 Successfully moved podcast:txt tags!');
    console.log('\n📋 Updated playlists:');
    results.filter(r => r.status === 'updated').forEach(result => {
      console.log(`  • ${result.file}`);
      console.log(`    Link: ${result.linkUrl}`);
      console.log(`    RSS: ${result.rssUrl}`);
    });
  }

} catch (error) {
  console.error('❌ Error moving podcast:txt tags:', error.message);
  process.exit(1);
}

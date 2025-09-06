#!/usr/bin/env node

import axios from 'axios';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

console.log('📥 Downloading all XML playlists from GitHub repository...\n');

const githubApiUrl = 'https://api.github.com/repos/ChadFarrow/chadf-musicl-playlists/contents/docs';
const githubRawUrl = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs';
const localPlaylistsDir = './playlists';

try {
  // Ensure local directory exists
  if (!existsSync(localPlaylistsDir)) {
    mkdirSync(localPlaylistsDir, { recursive: true });
    console.log(`📁 Created directory: ${localPlaylistsDir}`);
  }

  // Get list of files from GitHub
  console.log('📊 Fetching file list from GitHub...');
  const response = await axios.get(githubApiUrl, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'musicl-playlist-updater'
    }
  });

  const files = response.data;
  const xmlFiles = files.filter(file => 
    file.name.endsWith('.xml') && 
    file.type === 'file'
  );

  console.log(`📊 Found ${xmlFiles.length} XML playlist files:`);
  xmlFiles.forEach(file => {
    console.log(`  • ${file.name}`);
  });

  console.log('\n📥 Downloading playlists...\n');

  // Download each XML file
  const results = [];
  for (const file of xmlFiles) {
    try {
      const rawUrl = `${githubRawUrl}/${file.name}`;
      
      console.log(`⬇️  Downloading: ${file.name}`);
      const fileResponse = await axios.get(rawUrl, {
        headers: {
          'Accept': 'application/xml, text/xml, */*',
          'User-Agent': 'musicl-playlist-updater'
        },
        timeout: 10000
      });

      const localPath = join(localPlaylistsDir, file.name);
      writeFileSync(localPath, fileResponse.data, 'utf8');

      // Parse basic info
      const content = fileResponse.data;
      const titleMatch = content.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/);
      const itemMatches = content.match(/<item>/g);
      const itemCount = itemMatches ? itemMatches.length : 0;
      
      const title = titleMatch ? titleMatch[1] : file.name.replace('.xml', '');
      
      results.push({
        file: file.name,
        success: true,
        localPath,
        title,
        itemCount,
        size: content.length
      });

      console.log(`✅ Downloaded: ${file.name}`);
      console.log(`   Title: ${title}`);
      console.log(`   Items: ${itemCount}`);
      console.log(`   Size: ${content.length} characters`);
      console.log('');

    } catch (error) {
      console.error(`❌ Failed to download ${file.name}:`, error.message);
      results.push({ file: file.name, success: false, error: error.message });
    }
  }

  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log('📊 Download Summary:');
  console.log(`✅ Successful: ${successful}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📁 Local directory: ${localPlaylistsDir}`);

  if (successful > 0) {
    console.log('\n🎉 Playlists downloaded successfully!');
    console.log('💡 You can now work with the actual playlists from your repository.');
    console.log('\n📋 Downloaded playlists:');
    results.filter(r => r.success).forEach(result => {
      console.log(`  • ${result.file} - ${result.title} (${result.itemCount} items)`);
    });
  }

} catch (error) {
  console.error('❌ Error downloading playlists:', error.message);
  if (error.response) {
    console.error('Status:', error.response.status);
    console.error('Data:', error.response.data);
  }
  process.exit(1);
}

#!/usr/bin/env node

import { PlaylistUpdater } from './update-playlist.js';

const updater = new PlaylistUpdater();
const command = process.argv[2];
const playlistId = process.argv[3];

switch (command) {
  case 'update':
    if (playlistId) {
      updater.updatePlaylist(playlistId).catch(error => {
        console.error('❌ Error:', error.message);
        process.exit(1);
      });
    } else {
      console.log('❌ Please specify a playlist ID');
      console.log('Usage: node update-cli.js update <playlist-id>');
      console.log('\nAvailable playlists:');
      console.log('  • ITDV-music-playlist');
      console.log('  • HGH-music-playlist');
      console.log('  • MMT-muic-playlist');
      console.log('  • flowgnar-music-playlist');
      console.log('  • upbeats-music-playlist');
      console.log('  • SAS-music-playlist');
      console.log('  • IAM-music-playlist');
      console.log('  • MMM-music-playlist');
      console.log('  • b4ts-music-playlist');
    }
    break;
    
  case 'update-all':
    updater.updateAllPlaylists().catch(error => {
      console.error('❌ Error:', error.message);
      process.exit(1);
    });
    break;
    
  case 'status':
    if (playlistId) {
      updater.checkPlaylistStatus(playlistId).then(status => {
        console.log('\n📊 Playlist Status:');
        console.log(`Title: ${status.title}`);
        console.log(`Published: ${status.pubDate}`);
        console.log(`Last Build: ${status.lastBuildDate}`);
        console.log(`Items: ${status.itemCount}`);
        console.log(`RSS URL: ${status.rssUrl}`);
        console.log(`File Size: ${status.fileSize} characters`);
      }).catch(error => {
        console.error('❌ Error:', error.message);
        process.exit(1);
      });
    } else {
      console.log('❌ Please specify a playlist ID');
      console.log('Usage: node update-cli.js status <playlist-id>');
    }
    break;
    
  default:
    console.log(`
🔄 Playlist Updater CLI

Usage: node update-cli.js <command> [playlist-id]

Commands:
  update <playlist-id>    Update a specific playlist
  update-all             Update all playlists  
  status <playlist-id>   Check status of a playlist

Examples:
  node update-cli.js update ITDV-music-playlist
  node update-cli.js update-all
  node update-cli.js status ITDV-music-playlist

Available playlists:
  • ITDV-music-playlist (Into The Doerfel-Verse)
  • HGH-music-playlist (Homegrown Hits)
  • MMT-muic-playlist (Mike's Mix Tape)
  • flowgnar-music-playlist (Flowgnar)
  • upbeats-music-playlist (UpBEATs)
  • SAS-music-playlist (Sats and Sounds)
  • IAM-music-playlist (It's A Mood)
  • MMM-music-playlist (Mutton, Mead & Music)
  • b4ts-music-playlist (Behind The Sch3m3s)

This tool updates playlists by fetching fresh content from their source RSS feeds.
    `);
    break;
}

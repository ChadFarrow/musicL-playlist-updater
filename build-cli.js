#!/usr/bin/env node

import { MusicPlaylistBuilder } from './build-music-playlist.js';

const builder = new MusicPlaylistBuilder();
const command = process.argv[2];
const playlistId = process.argv[3];
const rssUrl = process.argv[4];

switch (command) {
  case 'build':
    if (playlistId && rssUrl) {
      builder.buildMusicPlaylist(playlistId, rssUrl).catch(error => {
        console.error('❌ Error:', error.message);
        process.exit(1);
      });
    } else {
      console.log('❌ Please specify playlist ID and RSS URL');
      console.log('Usage: node build-cli.js build <playlist-id> <rss-url>');
      console.log('\nExample:');
      console.log('  node build-cli.js build ITDV-music-playlist https://www.doerfelverse.com/feeds/intothedoerfelverse.xml');
    }
    break;
    
  case 'rebuild':
    if (playlistId) {
      builder.buildFromExistingPlaylist(playlistId).catch(error => {
        console.error('❌ Error:', error.message);
        process.exit(1);
      });
    } else {
      console.log('❌ Please specify a playlist ID');
      console.log('Usage: node build-cli.js rebuild <playlist-id>');
      console.log('\nAvailable playlists:');
      console.log('  • ITDV-music-playlist (Into The Doerfel-Verse)');
      console.log('  • HGH-music-playlist (Homegrown Hits)');
      console.log('  • MMT-muic-playlist (Mike\'s Mix Tape)');
      console.log('  • flowgnar-music-playlist (Flowgnar)');
      console.log('  • upbeats-music-playlist (UpBEATs)');
      console.log('  • SAS-music-playlist (Sats and Sounds)');
      console.log('  • IAM-music-playlist (It\'s A Mood)');
      console.log('  • MMM-music-playlist (Mutton, Mead & Music)');
      console.log('  • b4ts-music-playlist (Behind The Sch3m3s)');
    }
    break;
    
  default:
    console.log(`
🎵 Music Playlist Builder CLI

Usage: node build-cli.js <command> [playlist-id] [rss-url]

Commands:
  build <playlist-id> <rss-url>    Build a new music playlist from RSS feed
  rebuild <playlist-id>           Rebuild existing playlist from its RSS feed

Examples:
  node build-cli.js rebuild ITDV-music-playlist
  node build-cli.js build new-playlist https://example.com/feed.xml

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

This tool builds music playlists with podcast:remoteItem entries from RSS feeds.
    `);
    break;
}

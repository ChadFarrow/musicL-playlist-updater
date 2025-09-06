import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';

export class PlaylistUpdater {
  constructor(outputDir = './playlists') {
    this.outputDir = outputDir;
    this.ensureOutputDir();
  }

  ensureOutputDir() {
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
      logger.info(`Created output directory: ${this.outputDir}`);
    }
  }

  generatePlaylistXML(feedConfig, episodes, feedInfo) {
    const guid = feedConfig.playlistGuid || this.generateGUID();
    const pubDate = new Date().toUTCString();
    
    // Generate items XML
    const itemsXML = episodes.map(episode => {
      let itemXML = `    <item>
      <title><![CDATA[${episode.title}]]></title>
      <guid isPermaLink="false">${episode.guid}</guid>
      <link>${episode.link}</link>
      <pubDate>${episode.pubDate}</pubDate>
      <description><![CDATA[${episode.description || ''}]]></description>`;

      // Add enclosure if available
      if (episode.enclosure) {
        itemXML += `
      <enclosure url="${episode.enclosure.url}" type="${episode.enclosure.type}" length="${episode.enclosure.length || 0}"/>`;
      }

      // Add podcast:remoteItem if available
      if (episode.remoteItem) {
        itemXML += `
      <podcast:remoteItem feedGuid="${episode.remoteItem.feedGuid}" feedURL="${episode.remoteItem.feedURL}" itemGuid="${episode.remoteItem.itemGuid}"/>`;
      }

      // Add value tags if available
      if (episode.value) {
        itemXML += `
      <podcast:value type="${episode.valueType || 'lightning'}" method="${episode.valueMethod || 'keysend'}">
        <podcast:valueRecipient name="${episode.valueRecipient?.name || ''}" type="${episode.valueRecipient?.type || 'node'}" address="${episode.valueRecipient?.address || ''}" split="${episode.valueRecipient?.split || 0}"/>
      </podcast:value>`;
      }

      itemXML += `
    </item>`;
      return itemXML;
    }).join('\n');

    const playlistXML = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0" version="2.0">
  <channel>
    <title><![CDATA[${feedConfig.playlistTitle}]]></title>
    <link>${feedInfo.link || feedConfig.rssUrl}</link>
    <description><![CDATA[${feedConfig.playlistDescription}]]></description>
    <language>en-us</language>
    <copyright><![CDATA[${feedConfig.playlistAuthor}]]></copyright>
    <managingEditor>${feedConfig.playlistAuthor}</managingEditor>
    <pubDate>${pubDate}</pubDate>
    <lastBuildDate>${pubDate}</lastBuildDate>
    <generator>Auto musicL Maker</generator>
    <docs>https://cyber.harvard.edu/rss/rss.html</docs>
    <image>
      <url>${feedConfig.playlistImageUrl}</url>
      <title><![CDATA[${feedConfig.playlistTitle}]]></title>
      <link>${feedInfo.link || feedConfig.rssUrl}</link>
    </image>
    <podcast:medium>musicL</podcast:medium>
    <podcast:guid>${guid}</podcast:guid>
${itemsXML}
  </channel>
</rss>`;

    return playlistXML;
  }

  generateGUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async updatePlaylist(feedConfig, episodes, feedInfo) {
    try {
      logger.info(`Updating playlist for feed: ${feedConfig.name}`);
      
      const playlistXML = this.generatePlaylistXML(feedConfig, episodes, feedInfo);
      const filename = `${feedConfig.playlistId}.xml`;
      const filepath = join(this.outputDir, filename);
      
      writeFileSync(filepath, playlistXML, 'utf8');
      
      logger.info(`Playlist updated: ${filepath}`);
      
      return {
        success: true,
        filepath,
        filename,
        episodeCount: episodes.length,
        guid: feedConfig.playlistGuid || this.generateGUID()
      };
    } catch (error) {
      logger.error(`Failed to update playlist for ${feedConfig.name}:`, error);
      throw error;
    }
  }

  async createPlaylistFromFeed(feedConfig, episodes, feedInfo) {
    // Generate a GUID if not provided
    if (!feedConfig.playlistGuid) {
      feedConfig.playlistGuid = this.generateGUID();
    }

    return await this.updatePlaylist(feedConfig, episodes, feedInfo);
  }

  getPlaylistPath(playlistId) {
    return join(this.outputDir, `${playlistId}.xml`);
  }

  playlistExists(playlistId) {
    return existsSync(this.getPlaylistPath(playlistId));
  }

  readPlaylist(playlistId) {
    const filepath = this.getPlaylistPath(playlistId);
    if (existsSync(filepath)) {
      return readFileSync(filepath, 'utf8');
    }
    return null;
  }

  deletePlaylist(playlistId) {
    const filepath = this.getPlaylistPath(playlistId);
    if (existsSync(filepath)) {
      const fs = require('fs');
      fs.unlinkSync(filepath);
      logger.info(`Deleted playlist: ${filepath}`);
      return true;
    }
    return false;
  }
}

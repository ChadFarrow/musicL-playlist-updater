import Parser from 'rss-parser';
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export class RSSMonitor {
  constructor(configPath = './src/config/feeds.json') {
    this.configPath = configPath;
    this.parser = new Parser({
      customFields: {
        item: [
          ['podcast:remoteItem', 'remoteItem'],
          ['podcast:value', 'value'],
          ['podcast:valueRecipient', 'valueRecipient'],
          ['podcast:valueType', 'valueType'],
          ['podcast:valueMethod', 'valueMethod']
        ]
      }
    });
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      const configData = readFileSync(this.configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      logger.error('Failed to load config:', error);
      return { feeds: [], settings: {} };
    }
  }

  saveConfig() {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      logger.info('Config saved successfully');
    } catch (error) {
      logger.error('Failed to save config:', error);
    }
  }

  async checkFeed(feedConfig) {
    try {
      logger.info(`Checking feed: ${feedConfig.name} (${feedConfig.rssUrl})`);
      
      const feed = await this.parser.parseURL(feedConfig.rssUrl);
      
      if (!feed.items || feed.items.length === 0) {
        logger.warn(`No items found in feed: ${feedConfig.name}`);
        return { hasNewEpisodes: false, newEpisodes: [] };
      }

      // Get the latest episode
      const latestEpisode = feed.items[0];
      const latestGuid = latestEpisode.guid || latestEpisode.link;

      // Check if this is a new episode
      const hasNewEpisodes = feedConfig.lastEpisodeGuid !== latestGuid;
      
      if (hasNewEpisodes) {
        logger.info(`New episode detected in ${feedConfig.name}: ${latestEpisode.title}`);
        
        // Update the last checked info
        feedConfig.lastChecked = new Date().toISOString();
        feedConfig.lastEpisodeGuid = latestGuid;
        
        // Get all episodes (for now, we'll include all episodes in the playlist)
        const newEpisodes = feed.items.map(item => ({
          title: item.title,
          guid: item.guid || item.link,
          link: item.link,
          pubDate: item.pubDate,
          description: item.contentSnippet || item.content,
          enclosure: item.enclosure,
          remoteItem: item.remoteItem,
          value: item.value,
          valueRecipient: item.valueRecipient,
          valueType: item.valueType,
          valueMethod: item.valueMethod
        }));

        this.saveConfig();
        return { hasNewEpisodes: true, newEpisodes, feedInfo: feed };
      } else {
        logger.info(`No new episodes in ${feedConfig.name}`);
        feedConfig.lastChecked = new Date().toISOString();
        this.saveConfig();
        return { hasNewEpisodes: false, newEpisodes: [] };
      }

    } catch (error) {
      logger.error(`Error checking feed ${feedConfig.name}:`, error);
      throw error;
    }
  }

  async checkAllFeeds() {
    const results = [];
    const enabledFeeds = this.config.feeds.filter(feed => feed.enabled);

    logger.info(`Checking ${enabledFeeds.length} enabled feeds`);

    for (const feed of enabledFeeds) {
      try {
        const result = await this.checkFeed(feed);
        results.push({
          feedId: feed.id,
          feedName: feed.name,
          ...result
        });
      } catch (error) {
        logger.error(`Failed to check feed ${feed.id}:`, error);
        results.push({
          feedId: feed.id,
          feedName: feed.name,
          hasNewEpisodes: false,
          newEpisodes: [],
          error: error.message
        });
      }
    }

    return results;
  }

  addFeed(feedConfig) {
    const newFeed = {
      id: feedConfig.id || `feed-${Date.now()}`,
      name: feedConfig.name,
      rssUrl: feedConfig.rssUrl,
      playlistId: feedConfig.playlistId,
      playlistTitle: feedConfig.playlistTitle,
      playlistDescription: feedConfig.playlistDescription,
      playlistAuthor: feedConfig.playlistAuthor,
      playlistImageUrl: feedConfig.playlistImageUrl,
      enabled: feedConfig.enabled !== false,
      lastChecked: null,
      lastEpisodeGuid: null,
      checkIntervalMinutes: feedConfig.checkIntervalMinutes || this.config.settings.defaultCheckInterval
    };

    this.config.feeds.push(newFeed);
    this.saveConfig();
    logger.info(`Added new feed: ${newFeed.name}`);
    return newFeed;
  }

  removeFeed(feedId) {
    const index = this.config.feeds.findIndex(feed => feed.id === feedId);
    if (index !== -1) {
      const removedFeed = this.config.feeds.splice(index, 1)[0];
      this.saveConfig();
      logger.info(`Removed feed: ${removedFeed.name}`);
      return removedFeed;
    }
    return null;
  }

  updateFeed(feedId, updates) {
    const feed = this.config.feeds.find(f => f.id === feedId);
    if (feed) {
      Object.assign(feed, updates);
      this.saveConfig();
      logger.info(`Updated feed: ${feed.name}`);
      return feed;
    }
    return null;
  }

  getFeed(feedId) {
    return this.config.feeds.find(f => f.id === feedId);
  }

  getAllFeeds() {
    return this.config.feeds;
  }
}

import cron from 'node-cron';
import { readFileSync } from 'fs';
import { join } from 'path';
import { RSSMonitor } from './RSSMonitor.js';
import { PlaylistMonitor } from './PlaylistMonitor.js';
import { PlaylistUpdater } from './PlaylistUpdater.js';
import { RSSPlaylistGenerator } from './RSSPlaylistGenerator.js';
import { GitHubSync } from './GitHubSync.js';
import { logger } from '../utils/logger.js';

export class Scheduler {
  constructor(config) {
    this.config = config;
    this.rssMonitor = new RSSMonitor();
    this.playlistMonitor = new PlaylistMonitor(config);
    this.playlistUpdater = new PlaylistUpdater(config.playlistsDir || './playlists');
    this.rssPlaylistGenerator = new RSSPlaylistGenerator(config);
    this.githubSync = config.githubToken ? new GitHubSync(
      config.githubToken,
      config.githubRepoOwner,
      config.githubRepoName,
      config.githubRepoBranch
    ) : null;
    this.jobs = new Map();
    this.isRunning = false;
    this.monitorMode = config.monitorMode || 'rss'; // 'rss', 'playlist', or 'rss-to-playlist'
  }

  start() {
    if (this.isRunning) {
      logger.warn('Scheduler is already running');
      return;
    }

    logger.info('Starting RSS feed scheduler');
    this.isRunning = true;

    // Schedule each feed according to its individual interval
    this.scheduleAllFeeds();

    // Also run an immediate check
    this.runImmediateCheck();
  }

  stop() {
    if (!this.isRunning) {
      logger.warn('Scheduler is not running');
      return;
    }

    logger.info('Stopping RSS feed scheduler');
    
    // Stop all cron jobs
    for (const [feedId, job] of this.jobs) {
      job.destroy();
      logger.info(`Stopped job for feed: ${feedId}`);
    }
    
    this.jobs.clear();
    this.isRunning = false;
  }

  scheduleAllFeeds() {
    if (this.monitorMode === 'playlist') {
      const playlists = this.getPlaylistConfigs();
      
      for (const playlist of playlists) {
        if (playlist.enabled) {
          this.schedulePlaylist(playlist);
        }
      }
    } else if (this.monitorMode === 'rss-to-playlist') {
      const rssFeeds = this.getRSSFeedConfigs();
      
      for (const feed of rssFeeds) {
        if (feed.enabled) {
          this.scheduleRSSFeed(feed);
        }
      }
    } else {
      const feeds = this.rssMonitor.getAllFeeds();
      
      for (const feed of feeds) {
        if (feed.enabled) {
          this.scheduleFeed(feed);
        }
      }
    }
  }

  scheduleFeed(feed) {
    const cronExpression = this.getCronExpression(feed.checkIntervalMinutes);
    
    logger.info(`Scheduling feed ${feed.name} to check every ${feed.checkIntervalMinutes} minutes`);

    const job = cron.schedule(cronExpression, async () => {
      try {
        await this.checkAndUpdateFeed(feed.id);
      } catch (error) {
        logger.error(`Error in scheduled job for feed ${feed.id}:`, error);
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.set(feed.id, job);
  }

  unscheduleFeed(feedId) {
    const job = this.jobs.get(feedId);
    if (job) {
      job.destroy();
      this.jobs.delete(feedId);
      logger.info(`Unscheduled feed: ${feedId}`);
    }
  }

  rescheduleFeed(feedId) {
    this.unscheduleFeed(feedId);
    const feed = this.rssMonitor.getFeed(feedId);
    if (feed && feed.enabled) {
      this.scheduleFeed(feed);
    }
  }

  getCronExpression(minutes) {
    // Convert minutes to cron expression
    // For simplicity, we'll check every X minutes
    if (minutes < 1) minutes = 1;
    if (minutes > 59) minutes = 59;
    
    return `*/${minutes} * * * *`;
  }

  async runImmediateCheck() {
    if (this.monitorMode === 'playlist') {
      logger.info('Running immediate check of all playlists');
      
      try {
        const playlistConfigs = this.getPlaylistConfigs();
        const results = await this.playlistMonitor.checkAllPlaylists(playlistConfigs);
        
        for (const result of results) {
          if (result.hasUpdates && !result.error) {
            logger.info(`Playlist ${result.playlistName} has updates`);
            // Parse the playlist content to get metadata
            const playlistInfo = this.playlistMonitor.parsePlaylistContent(result.playlistData.content);
            if (playlistInfo) {
              logger.info(`Playlist info: ${playlistInfo.title} (${playlistInfo.itemCount} items)`);
            }
          }
        }
      } catch (error) {
        logger.error('Error in immediate playlist check:', error);
      }
    } else {
      logger.info('Running immediate check of all feeds');
      
      try {
        const results = await this.rssMonitor.checkAllFeeds();
        
        for (const result of results) {
          if (result.hasNewEpisodes && !result.error) {
            await this.updatePlaylistForFeed(result.feedId, result.newEpisodes, result.feedInfo);
          }
        }
      } catch (error) {
        logger.error('Error in immediate check:', error);
      }
    }
  }

  async checkAndUpdateFeed(feedId) {
    try {
      const feed = this.rssMonitor.getFeed(feedId);
      if (!feed) {
        logger.error(`Feed not found: ${feedId}`);
        return;
      }

      logger.info(`Checking feed: ${feed.name}`);
      
      const result = await this.rssMonitor.checkFeed(feed);
      
      if (result.hasNewEpisodes) {
        logger.info(`New episodes found for ${feed.name}, updating playlist`);
        await this.updatePlaylistForFeed(feedId, result.newEpisodes, result.feedInfo);
      }
    } catch (error) {
      logger.error(`Error checking feed ${feedId}:`, error);
    }
  }

  async updatePlaylistForFeed(feedId, episodes, feedInfo) {
    try {
      const feed = this.rssMonitor.getFeed(feedId);
      if (!feed) {
        logger.error(`Feed not found: ${feedId}`);
        return;
      }

      // Update the playlist
      const result = await this.playlistUpdater.updatePlaylist(feed, episodes, feedInfo);
      
      logger.logUpdate(feed.name, episodes.length, 'updated');

      // Sync to GitHub if enabled
      if (this.githubSync && this.config.enableGitHubSync) {
        try {
          await this.githubSync.syncPlaylist(result.filepath, feed.playlistId);
          logger.info(`Synced playlist ${feed.playlistId} to GitHub`);
        } catch (error) {
          logger.error(`Failed to sync playlist ${feed.playlistId} to GitHub:`, error);
        }
      }

      return result;
    } catch (error) {
      logger.logError(`updatePlaylistForFeed-${feedId}`, error);
      throw error;
    }
  }

  async addFeed(feedConfig) {
    try {
      const newFeed = this.rssMonitor.addFeed(feedConfig);
      
      if (newFeed.enabled) {
        this.scheduleFeed(newFeed);
      }
      
      logger.info(`Added and scheduled new feed: ${newFeed.name}`);
      return newFeed;
    } catch (error) {
      logger.error('Error adding feed:', error);
      throw error;
    }
  }

  async removeFeed(feedId) {
    try {
      this.unscheduleFeed(feedId);
      const removedFeed = this.rssMonitor.removeFeed(feedId);
      
      if (removedFeed) {
        // Optionally delete the playlist file
        this.playlistUpdater.deletePlaylist(removedFeed.playlistId);
        logger.info(`Removed feed and playlist: ${removedFeed.name}`);
      }
      
      return removedFeed;
    } catch (error) {
      logger.error('Error removing feed:', error);
      throw error;
    }
  }

  async updateFeed(feedId, updates) {
    try {
      const updatedFeed = this.rssMonitor.updateFeed(feedId, updates);
      
      if (updatedFeed) {
        // Reschedule if interval changed
        if (updates.checkIntervalMinutes) {
          this.rescheduleFeed(feedId);
        }
        
        logger.info(`Updated feed: ${updatedFeed.name}`);
      }
      
      return updatedFeed;
    } catch (error) {
      logger.error('Error updating feed:', error);
      throw error;
    }
  }

  getPlaylistConfigs() {
    try {
      const configPath = join(process.cwd(), 'src', 'config', 'feeds.json');
      const configData = JSON.parse(readFileSync(configPath, 'utf8'));
      return configData.playlists || [];
    } catch (error) {
      logger.error('Error loading playlist configs:', error);
      return [];
    }
  }

  getRSSFeedConfigs() {
    try {
      const configPath = join(process.cwd(), 'src', 'config', 'feeds.json');
      const configData = JSON.parse(readFileSync(configPath, 'utf8'));
      return configData.rssFeeds || [];
    } catch (error) {
      logger.error('Error loading RSS feed configs:', error);
      return [];
    }
  }

  schedulePlaylist(playlist) {
    const cronExpression = this.getCronExpression(playlist.checkIntervalMinutes);
    
    logger.info(`Scheduling playlist ${playlist.name} to check every ${playlist.checkIntervalMinutes} minutes`);

    const job = cron.schedule(cronExpression, async () => {
      try {
        await this.checkAndUpdatePlaylist(playlist.id);
      } catch (error) {
        logger.error(`Error in scheduled job for playlist ${playlist.id}:`, error);
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.set(playlist.id, job);
  }

  async checkAndUpdatePlaylist(playlistId) {
    try {
      const playlistConfigs = this.getPlaylistConfigs();
      const playlist = playlistConfigs.find(p => p.id === playlistId);
      
      if (!playlist) {
        logger.error(`Playlist not found: ${playlistId}`);
        return;
      }

      logger.info(`Checking playlist: ${playlist.name}`);
      
      const result = await this.playlistMonitor.checkPlaylistForUpdates(playlist);
      
      if (result.hasUpdates) {
        logger.info(`Updates found for ${playlist.name}`);
        const playlistInfo = this.playlistMonitor.parsePlaylistContent(result.playlistData.content);
        if (playlistInfo) {
          logger.info(`Updated playlist: ${playlistInfo.title} (${playlistInfo.itemCount} items)`);
        }
      }
    } catch (error) {
      logger.error(`Error checking playlist ${playlistId}:`, error);
    }
  }

  scheduleRSSFeed(feed) {
    const cronExpression = this.getCronExpression(feed.checkIntervalMinutes);
    
    logger.info(`Scheduling RSS feed ${feed.name} to generate playlist every ${feed.checkIntervalMinutes} minutes`);

    const job = cron.schedule(cronExpression, async () => {
      try {
        await this.checkAndGeneratePlaylistFromRSS(feed.id);
      } catch (error) {
        logger.error(`Error in scheduled job for RSS feed ${feed.id}:`, error);
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.set(feed.id, job);
  }

  async checkAndGeneratePlaylistFromRSS(feedId) {
    try {
      const rssFeeds = this.getRSSFeedConfigs();
      const feed = rssFeeds.find(f => f.id === feedId);
      
      if (!feed) {
        logger.error(`RSS feed not found: ${feedId}`);
        return;
      }

      logger.info(`Checking RSS feed: ${feed.name}`);
      
      const result = await this.rssPlaylistGenerator.checkFeedForUpdates(feed);
      
      if (result.hasUpdates) {
        logger.info(`New episodes found in ${feed.name}, generating playlist`);
        const playlistResult = await this.rssPlaylistGenerator.generatePlaylistFromRSS(feed);
        
        if (playlistResult.success) {
          logger.info(`Successfully generated playlist: ${playlistResult.episodeCount} episodes`);
          logger.info(`Latest episode: ${playlistResult.lastEpisode}`);
        }
      }
    } catch (error) {
      logger.error(`Error checking RSS feed ${feedId}:`, error);
    }
  }

  getStatus() {
    if (this.monitorMode === 'playlist') {
      const playlists = this.getPlaylistConfigs();
      return {
        isRunning: this.isRunning,
        activeJobs: this.jobs.size,
        monitorMode: 'playlist',
        playlists: playlists.map(playlist => ({
          id: playlist.id,
          name: playlist.name,
          enabled: playlist.enabled,
          scheduled: this.jobs.has(playlist.id),
          lastChecked: playlist.lastChecked,
          checkIntervalMinutes: playlist.checkIntervalMinutes
        }))
      };
    } else if (this.monitorMode === 'rss-to-playlist') {
      const rssFeeds = this.getRSSFeedConfigs();
      return {
        isRunning: this.isRunning,
        activeJobs: this.jobs.size,
        monitorMode: 'rss-to-playlist',
        rssFeeds: rssFeeds.map(feed => ({
          id: feed.id,
          name: feed.name,
          rssUrl: feed.rssUrl,
          playlistId: feed.playlistId,
          enabled: feed.enabled,
          scheduled: this.jobs.has(feed.id),
          lastChecked: feed.lastChecked,
          checkIntervalMinutes: feed.checkIntervalMinutes
        }))
      };
    } else {
      return {
        isRunning: this.isRunning,
        activeJobs: this.jobs.size,
        monitorMode: 'rss',
        feeds: this.rssMonitor.getAllFeeds().map(feed => ({
          id: feed.id,
          name: feed.name,
          enabled: feed.enabled,
          scheduled: this.jobs.has(feed.id),
          lastChecked: feed.lastChecked,
          checkIntervalMinutes: feed.checkIntervalMinutes
        }))
      };
    }
  }
}

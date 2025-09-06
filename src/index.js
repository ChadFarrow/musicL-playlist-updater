import { readFileSync } from 'fs';
import { Scheduler } from './services/Scheduler.js';
import { RSSMonitor } from './services/RSSMonitor.js';
import { PlaylistUpdater } from './services/PlaylistUpdater.js';
import { PlaylistDiscovery } from './services/PlaylistDiscovery.js';
import { logger } from './utils/logger.js';

// Load configuration
let config = {};
try {
  const configData = readFileSync('./config.json', 'utf8');
  config = JSON.parse(configData);
} catch (error) {
  logger.warn('No config.json found, using defaults');
}

class MusicLPlaylistUpdater {
  constructor() {
    this.config = this.loadConfig();
    this.scheduler = new Scheduler(this.config);
  }

  getMonitorMode() {
    try {
      const feedsConfigPath = './src/config/feeds.json';
      const feedsConfig = JSON.parse(readFileSync(feedsConfigPath, 'utf8'));
      return feedsConfig.settings?.monitorMode || 'playlist';
    } catch (error) {
      logger.warn('Could not read monitor mode from feeds.json, using default');
      return 'playlist';
    }
  }

  loadConfig() {
    return {
      checkIntervalMinutes: config.monitoring?.checkIntervalMinutes || 30,
      maxRetries: config.monitoring?.maxRetries || 3,
      retryDelayMs: config.monitoring?.retryDelayMs || 5000,
      
      // GitHub settings
      githubToken: config.github?.token,
      githubRepoOwner: config.github?.repoOwner || 'ChadFarrow',
      githubRepoName: config.github?.repoName || 'chadf-musicl-playlists',
      githubRepoBranch: config.github?.repoBranch || 'main',
      enableGitHubSync: config.github?.enableSync || false,
      
      // Monitor mode
      monitorMode: this.getMonitorMode(),
      
      // Storage settings
      playlistsDir: config.storage?.playlistsDir || './playlists',
      dataDir: config.storage?.dataDir || './data',
      
      // Notification settings
      webhookUrl: config.notifications?.webhookUrl,
      enableNotifications: !!config.notifications?.webhookUrl,
      
      // Logging
      logLevel: config.logging?.level || 'info'
    };
  }

  async start() {
    try {
      logger.info('Starting MusicL Playlist Updater');
      logger.info('Configuration:', {
        checkInterval: `${this.config.checkIntervalMinutes} minutes`,
        githubSync: this.config.enableGitHubSync,
        playlistsDir: this.config.playlistsDir
      });

      // Start the scheduler
      this.scheduler.start();

      // Set up graceful shutdown
      this.setupGracefulShutdown();

      logger.info('MusicL Playlist Updater started successfully');
    } catch (error) {
      logger.error('Failed to start MusicL Playlist Updater:', error);
      process.exit(1);
    }
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      try {
        this.scheduler.stop();
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  // CLI methods for manual operations
  async addFeed(feedConfig) {
    try {
      const newFeed = await this.scheduler.addFeed(feedConfig);
      logger.info(`Added feed: ${newFeed.name}`);
      return newFeed;
    } catch (error) {
      logger.error('Failed to add feed:', error);
      throw error;
    }
  }

  async removeFeed(feedId) {
    try {
      const removedFeed = await this.scheduler.removeFeed(feedId);
      logger.info(`Removed feed: ${removedFeed?.name || feedId}`);
      return removedFeed;
    } catch (error) {
      logger.error('Failed to remove feed:', error);
      throw error;
    }
  }

  async updateFeed(feedId, updates) {
    try {
      const updatedFeed = await this.scheduler.updateFeed(feedId, updates);
      logger.info(`Updated feed: ${updatedFeed?.name || feedId}`);
      return updatedFeed;
    } catch (error) {
      logger.error('Failed to update feed:', error);
      throw error;
    }
  }

  async checkFeed(feedId) {
    try {
      const rssMonitor = new RSSMonitor();
      const feed = rssMonitor.getFeed(feedId);
      
      if (!feed) {
        throw new Error(`Feed not found: ${feedId}`);
      }

      const result = await rssMonitor.checkFeed(feed);
      
      if (result.hasNewEpisodes) {
        logger.info(`New episodes found for ${feed.name}`);
        const playlistUpdater = new PlaylistUpdater(this.config.playlistsDir);
        await playlistUpdater.updatePlaylist(feed, result.newEpisodes, result.feedInfo);
      } else {
        logger.info(`No new episodes for ${feed.name}`);
      }
      
      return result;
    } catch (error) {
      logger.error('Failed to check feed:', error);
      throw error;
    }
  }

  getStatus() {
    return this.scheduler.getStatus();
  }

  listFeeds() {
    if (this.config.monitorMode === 'playlist') {
      const scheduler = new Scheduler(this.config);
      return scheduler.getPlaylistConfigs();
    } else {
      const rssMonitor = new RSSMonitor();
      return rssMonitor.getAllFeeds();
    }
  }

  async discoverPlaylists() {
    try {
      const discovery = new PlaylistDiscovery(this.config);
      const playlists = await discovery.discoverPlaylists();
      
      // Update the configuration with discovered playlists
      await discovery.updatePlaylistConfig(playlists);
      
      logger.info(`Discovered ${playlists.length} playlists`);
      return playlists;
    } catch (error) {
      logger.error('Error discovering playlists:', error);
      throw error;
    }
  }
}

// CLI interface
async function main() {
  const updater = new MusicLPlaylistUpdater();
  
  const command = process.argv[2];
  const args = process.argv.slice(3);

  switch (command) {
    case 'start':
      await updater.start();
      break;
      
    case 'add-feed':
      if (args.length < 2) {
        console.log('Usage: npm start add-feed <name> <rssUrl> [playlistId]');
        process.exit(1);
      }
      const feedConfig = {
        name: args[0],
        rssUrl: args[1],
        playlistId: args[2] || args[0].toLowerCase().replace(/\s+/g, '-'),
        playlistTitle: args[0],
        playlistDescription: `Auto-updated playlist from ${args[0]}`,
        playlistAuthor: 'ChadFarrow'
      };
      await updater.addFeed(feedConfig);
      break;
      
    case 'remove-feed':
      if (args.length < 1) {
        console.log('Usage: npm start remove-feed <feedId>');
        process.exit(1);
      }
      await updater.removeFeed(args[0]);
      break;
      
    case 'check-feed':
      if (args.length < 1) {
        console.log('Usage: npm start check-feed <feedId>');
        process.exit(1);
      }
      await updater.checkFeed(args[0]);
      break;
      
    case 'status':
      try {
        const status = updater.getStatus();
        console.log('MusicL Playlist Updater Status:');
        console.log(`Running: ${status.isRunning}`);
        console.log(`Monitor Mode: ${status.monitorMode}`);
        console.log(`Active Jobs: ${status.activeJobs}`);
        if (status.playlists) {
          console.log(`\nConfigured Playlists (${status.playlists.length}):`);
          status.playlists.forEach(playlist => {
            console.log(`- ${playlist.name} (${playlist.enabled ? 'enabled' : 'disabled'}) - Last checked: ${playlist.lastChecked || 'never'}`);
          });
        }
        if (status.rssFeeds) {
          console.log(`\nConfigured RSS Feeds (${status.rssFeeds.length}):`);
          status.rssFeeds.forEach(feed => {
            console.log(`- ${feed.name} → ${feed.playlistId} (${feed.enabled ? 'enabled' : 'disabled'}) - Last checked: ${feed.lastChecked || 'never'}`);
          });
        }
        if (status.feeds) {
          console.log(`\nConfigured Feeds (${status.feeds.length}):`);
          status.feeds.forEach(feed => {
            console.log(`- ${feed.name} (${feed.enabled ? 'enabled' : 'disabled'}) - Last checked: ${feed.lastChecked || 'never'}`);
          });
        }
      } catch (error) {
        console.error('Error getting status:', error.message);
        process.exit(1);
      }
      break;
      
    case 'list-feeds':
      console.log(JSON.stringify(updater.listFeeds(), null, 2));
      break;
      
    case 'discover':
      try {
        console.log('Discovering playlists in docs folder...');
        const playlists = await updater.discoverPlaylists();
        console.log(`Found ${playlists.length} playlists:`);
        playlists.forEach(playlist => {
          console.log(`- ${playlist.name} (${playlist.itemCount} items)`);
        });
        console.log('Playlist discovery completed successfully!');
      } catch (error) {
        console.error('Error discovering playlists:', error.message);
        process.exit(1);
      }
      break;
      
    default:
      console.log(`
MusicL Playlist Updater

Usage: npm start <command> [args]

Commands:
  start                    Start the automatic updater
  discover                 Discover all XML playlists in docs folder
  add-feed <name> <url>    Add a new RSS feed to monitor
  remove-feed <id>         Remove a feed from monitoring
  check-feed <id>          Manually check a specific feed
  status                   Show current status
  list-feeds              List all configured feeds

Examples:
  npm start add-feed "My Podcast" "https://example.com/feed.xml"
  npm start check-feed example-feed-1
  npm start status
      `);
      break;
  }
}

// Run the CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error('CLI error:', error);
    process.exit(1);
  });
}

export { MusicLPlaylistUpdater };

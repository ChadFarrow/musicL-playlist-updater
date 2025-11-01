import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RSSPlaylistGenerator } from '../src/services/RSSPlaylistGenerator.js';
import { logger } from '../src/utils/logger.js';

// Load configuration
let config = {};
try {
  const configData = readFileSync('./config.json', 'utf8');
  config = JSON.parse(configData);
} catch (error) {
  logger.error('Failed to load config.json:', error);
  process.exit(1);
}

// Load feeds configuration
let feedsConfig = {};
try {
  const feedsConfigPath = './src/config/feeds.json';
  const feedsConfigData = readFileSync(feedsConfigPath, 'utf8');
  feedsConfig = JSON.parse(feedsConfigData);
} catch (error) {
  logger.error('Failed to load feeds.json:', error);
  process.exit(1);
}

// Build configuration object
const fullConfig = {
  playlistsDir: config.storage?.playlistsDir || './playlists',
  dataDir: config.storage?.dataDir || './data',
  
  // GitHub settings - check environment variable first, then config
  githubToken: process.env.GITHUB_TOKEN || config.github?.token,
  githubRepoOwner: config.github?.repoOwner || 'ChadFarrow',
  githubRepoName: config.github?.repoName || 'chadf-musicl-playlists',
  githubRepoBranch: config.github?.repoBranch || 'main',
  enableGitHubSync: config.github?.enableSync !== false,
  
  // Logging
  logLevel: config.logging?.level || 'info'
};

async function updateAllFeeds() {
  try {
    logger.info('Starting daily RSS feed update');
    
    if (!fullConfig.githubToken) {
      logger.warn('GitHub token not found. Set GITHUB_TOKEN environment variable or in config.json');
      logger.warn('Continuing with local updates only...');
    }
    
    const rssPlaylistGenerator = new RSSPlaylistGenerator(fullConfig);
    
    const enabledFeeds = feedsConfig.rssFeeds?.filter(feed => feed.enabled) || [];
    
    if (enabledFeeds.length === 0) {
      logger.warn('No enabled RSS feeds found in configuration');
      return { success: true, updated: 0 };
    }
    
    logger.info(`Checking ${enabledFeeds.length} enabled RSS feed(s)`);
    
    let updatedCount = 0;
    let errorCount = 0;
    
    for (const feedConfig of enabledFeeds) {
      try {
        logger.info(`Checking feed: ${feedConfig.name}`);
        
        // Check for updates
        const checkResult = await rssPlaylistGenerator.checkFeedForUpdates(feedConfig);
        
        if (checkResult.hasUpdates) {
          logger.info(`New episodes found in ${feedConfig.name}, generating playlist`);
          
          // Generate playlist from RSS feed
          const playlistResult = await rssPlaylistGenerator.generatePlaylistFromRSS(feedConfig);
          
          if (playlistResult.success) {
            logger.info(`Successfully updated playlist: ${playlistResult.episodeCount} episodes`);
            logger.info(`Latest episode: ${playlistResult.lastEpisode}`);
            updatedCount++;
          } else {
            logger.error(`Failed to generate playlist for ${feedConfig.name}`);
            errorCount++;
          }
        } else {
          logger.info(`No new episodes in ${feedConfig.name}`);
        }
        
      } catch (error) {
        logger.error(`Error processing feed ${feedConfig.name}:`, error);
        errorCount++;
      }
    }
    
    // Save the updated feed config (with lastChecked and lastEpisodeGuid) after all feeds processed
    saveFeedsConfig();
    
    logger.info(`Daily update complete: ${updatedCount} playlist(s) updated, ${errorCount} error(s)`);
    
    return {
      success: errorCount === 0,
      updated: updatedCount,
      errors: errorCount
    };
    
  } catch (error) {
    logger.error('Error during daily feed update:', error);
    throw error;
  }
}

function saveFeedsConfig() {
  try {
    const feedsConfigPath = './src/config/feeds.json';
    writeFileSync(feedsConfigPath, JSON.stringify(feedsConfig, null, 2), 'utf8');
    logger.debug('Feeds configuration saved');
  } catch (error) {
    logger.error('Failed to save feeds configuration:', error);
  }
}

// Run the update
updateAllFeeds()
  .then(result => {
    if (result.success) {
      logger.info('Daily update completed successfully');
      process.exit(0);
    } else {
      logger.error('Daily update completed with errors');
      process.exit(1);
    }
  })
  .catch(error => {
    logger.error('Fatal error during daily update:', error);
    process.exit(1);
  });


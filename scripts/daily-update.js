import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RSSPlaylistGenerator } from '../src/services/RSSPlaylistGenerator.js';
import { GitHubSync } from '../src/services/GitHubSync.js';
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

async function getFeedsFromFEEDSMd() {
  try {
    if (!fullConfig.githubToken) {
      logger.warn('GitHub token not found. Cannot fetch FEEDS.md from target repo.');
      return [];
    }

    const githubSync = new GitHubSync(
      fullConfig.githubToken,
      fullConfig.githubRepoOwner,
      fullConfig.githubRepoName,
      fullConfig.githubRepoBranch
    );

    logger.info('Fetching FEEDS.md from target repository...');
    const playlistIds = await githubSync.getFeedsFromMarkdown();
    
    if (playlistIds.length === 0) {
      logger.warn('No feeds found in FEEDS.md');
      return [];
    }

    logger.info(`Found ${playlistIds.length} playlist ID(s) in FEEDS.md: ${playlistIds.join(', ')}`);

    // Now discover the actual playlists for these IDs
    const allPlaylists = await githubSync.discoverPlaylists('docs');
    const feedsFromMd = allPlaylists.filter(playlist => playlistIds.includes(playlist.playlistId));

    if (feedsFromMd.length === 0) {
      logger.warn('No matching playlists found in docs/ for FEEDS.md entries');
      return [];
    }

    logger.info(`Matched ${feedsFromMd.length} playlist(s) from FEEDS.md:`);
    feedsFromMd.forEach(playlist => {
      logger.info(`  - ${playlist.playlistId} (${playlist.playlistTitle}) -> ${playlist.rssUrl}`);
    });

    return feedsFromMd;
  } catch (error) {
    logger.error('Failed to get feeds from FEEDS.md:', error);
    return [];
  }
}

async function discoverPlaylistsFromTargetRepo() {
  try {
    if (!fullConfig.githubToken) {
      logger.warn('GitHub token not found. Cannot discover playlists from target repo.');
      return [];
    }

    const githubSync = new GitHubSync(
      fullConfig.githubToken,
      fullConfig.githubRepoOwner,
      fullConfig.githubRepoName,
      fullConfig.githubRepoBranch
    );

    logger.info('Discovering playlists from target repository...');
    const playlists = await githubSync.discoverPlaylists('docs');
    
    if (playlists.length === 0) {
      logger.warn('No playlists with RSS feeds found in target repository');
      return [];
    }

    logger.info(`Discovered ${playlists.length} playlist(s) from target repository:`);
    playlists.forEach(playlist => {
      logger.info(`  - ${playlist.playlistId} (${playlist.playlistTitle}) -> ${playlist.rssUrl}`);
    });

    return playlists;
  } catch (error) {
    logger.error('Failed to discover playlists from target repository:', error);
    // Don't throw - fall back to configured feeds
    return [];
  }
}

async function updateAllFeeds() {
  try {
    logger.info('Starting daily RSS feed update');
    
    if (!fullConfig.githubToken) {
      logger.warn('GitHub token not found. Set GITHUB_TOKEN environment variable or in config.json');
      logger.warn('Continuing with local updates only...');
    }
    
    const rssPlaylistGenerator = new RSSPlaylistGenerator(fullConfig);
    
    // Get feeds from FEEDS.md in target repository
    const feedsFromMd = await getFeedsFromFEEDSMd();
    
    // Get configured feeds from feeds.json
    const configuredFeeds = feedsConfig.rssFeeds || [];
    
    // Use feeds from FEEDS.md if available, otherwise fall back to configured feeds
    let feedsToUpdate = [];
    
    if (feedsFromMd.length > 0) {
      // Create feed configs from FEEDS.md
      feedsToUpdate = feedsFromMd.map(playlist => {
        // Check if this feed is already configured in feeds.json
        const existingFeed = configuredFeeds.find(feed => feed.playlistId === playlist.playlistId);
        
        if (existingFeed) {
          // Use configured feed but update metadata from discovered playlist if missing
          return {
            ...existingFeed,
            rssUrl: existingFeed.rssUrl || playlist.rssUrl,
            playlistTitle: existingFeed.playlistTitle || playlist.playlistTitle,
            playlistDescription: existingFeed.playlistDescription || playlist.playlistDescription,
            playlistAuthor: existingFeed.playlistAuthor || playlist.playlistAuthor,
            playlistImageUrl: existingFeed.playlistImageUrl || playlist.playlistImageUrl,
            enabled: existingFeed.enabled !== undefined ? existingFeed.enabled : true
          };
        } else {
          // Create new feed config from discovered playlist
          return {
            id: `${playlist.playlistId}-feed`,
            name: playlist.playlistTitle || playlist.playlistId,
            rssUrl: playlist.rssUrl,
            playlistId: playlist.playlistId,
            playlistTitle: playlist.playlistTitle,
            playlistDescription: playlist.playlistDescription,
            playlistAuthor: playlist.playlistAuthor,
            playlistImageUrl: playlist.playlistImageUrl,
            enabled: true,
            lastChecked: null,
            lastEpisodeGuid: null,
            checkIntervalMinutes: 1440
          };
        }
      });
      
      logger.info(`Using ${feedsToUpdate.length} feed(s) from FEEDS.md:`);
    } else {
      // Fall back to configured feeds
      feedsToUpdate = configuredFeeds.filter(feed => feed.enabled);
      logger.info(`FEEDS.md not found or empty, using ${feedsToUpdate.length} configured feed(s):`);
    }
    
    if (feedsToUpdate.length === 0) {
      logger.warn('No RSS feeds to update');
      return { success: true, updated: 0 };
    }
    
    feedsToUpdate.forEach(feed => {
      logger.info(`  - ${feed.name || feed.id} (${feed.playlistId})`);
    });
    
    let updatedCount = 0;
    let errorCount = 0;
    
    // Update feeds from FEEDS.md (or configured feeds if FEEDS.md unavailable)
    for (const feedConfig of feedsToUpdate) {
      try {
        logger.info(`Checking feed: ${feedConfig.name || feedConfig.playlistId}`);
        
        if (!feedConfig.rssUrl) {
          logger.warn(`Skipping ${feedConfig.playlistId}: No RSS URL configured`);
          errorCount++;
          continue;
        }
        
        // Check for updates
        const checkResult = await rssPlaylistGenerator.checkFeedForUpdates(feedConfig);
        
        if (checkResult.hasUpdates) {
          logger.info(`New episodes found in ${feedConfig.name || feedConfig.playlistId}, generating playlist`);
          
          // Generate playlist from RSS feed
          const playlistResult = await rssPlaylistGenerator.generatePlaylistFromRSS(feedConfig);
          
          if (playlistResult.success) {
            logger.info(`Successfully updated playlist: ${playlistResult.episodeCount} episodes`);
            logger.info(`Latest episode: ${playlistResult.lastEpisode}`);
            updatedCount++;
          } else {
            logger.error(`Failed to generate playlist for ${feedConfig.name || feedConfig.playlistId}`);
            errorCount++;
          }
        } else {
          logger.info(`No new episodes in ${feedConfig.name || feedConfig.playlistId}`);
        }
        
      } catch (error) {
        logger.error(`Error processing feed ${feedConfig.name || feedConfig.playlistId}:`, error);
        errorCount++;
      }
    }
    
    // Update feeds.json with feeds from FEEDS.md if we used them
    if (feedsFromMd.length > 0) {
      // Merge with existing configured feeds, updating existing ones and adding new ones
      const existingFeedMap = new Map();
      configuredFeeds.forEach(feed => {
        existingFeedMap.set(feed.playlistId, feed);
      });
      
      // Update existing feeds and add new ones
      const updatedFeeds = [...configuredFeeds];
      feedsToUpdate.forEach(feed => {
        const existingIndex = updatedFeeds.findIndex(f => f.playlistId === feed.playlistId);
        if (existingIndex >= 0) {
          // Update existing feed while preserving lastChecked and lastEpisodeGuid
          updatedFeeds[existingIndex] = {
            ...feed,
            lastChecked: updatedFeeds[existingIndex].lastChecked,
            lastEpisodeGuid: updatedFeeds[existingIndex].lastEpisodeGuid
          };
        } else {
          // Add new feed
          updatedFeeds.push(feed);
        }
      });
      
      feedsConfig.rssFeeds = updatedFeeds;
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


import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RSSPlaylistGenerator } from '../src/services/RSSPlaylistGenerator.js';
import { CommunityPlaylistAggregator } from '../src/services/CommunityPlaylistAggregator.js';
import { GitHubSync } from '../src/services/GitHubSync.js';
import { logger } from '../src/utils/logger.js';
import { withRetry } from '../src/utils/retry.js';

const FEED_RETRIES = 2;
const FEED_RETRY_DELAY_MS = 10000;

// 403/404-style errors won't clear on retry and shouldn't fail the run
function isAccessError(error) {
  return !!error.message && (
    error.message.includes('Status code 403') ||
    error.message.includes('Status code 404') ||
    error.message.includes('403') ||
    error.message.includes('404') ||
    error.message.includes('Forbidden') ||
    error.message.includes('Not Found')
  );
}

// Surface a warning annotation on the GitHub Actions run summary page
function emitWorkflowWarning(feedName, error) {
  const message = `${feedName}: ${error.message}`.replace(/\r?\n/g, ' ');
  console.log(`::warning title=Feed update failed::${message}`);
}

// Load configuration (optional - use environment variables if config.json doesn't exist)
let config = {};
try {
  const configData = readFileSync('./config.json', 'utf8');
  config = JSON.parse(configData);
  logger.info('Loaded config.json');
} catch (error) {
  if (error.code === 'ENOENT') {
    // config.json doesn't exist - that's okay, we'll use environment variables and defaults
    logger.info('config.json not found, using environment variables and defaults');
    config = {};
  } else {
    logger.error('Failed to load config.json:', error);
    process.exit(1);
  }
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
  
  // PodPing settings - check environment variables first, then config
  podping: {
    enabled: config.podping?.enabled !== false,
    timeout: config.podping?.timeout || 10000,
    hiveNode: config.podping?.hiveNode || 'https://api.hive.blog',
    hiveUsername: process.env.HIVE_USERNAME || config.podping?.hiveUsername || '',
    hivePostingKey: process.env.HIVE_POSTING_KEY || config.podping?.hivePostingKey || ''
  },
  
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
    let processedCount = 0;

    // Update feeds from FEEDS.md (or configured feeds if FEEDS.md unavailable)
    for (const feedConfig of feedsToUpdate) {
      const feedName = feedConfig.name || feedConfig.playlistId;
      try {
        logger.info(`Checking feed: ${feedName}`);

        if (!feedConfig.rssUrl) {
          logger.warn(`Skipping ${feedConfig.playlistId}: No RSS URL configured`);
          errorCount++;
          continue;
        }

        // Transient errors (timeouts, network blips) get retried before counting as failures
        const outcome = await withRetry(async () => {
          // Check for updates
          const checkResult = await rssPlaylistGenerator.checkFeedForUpdates(feedConfig);

          // Force update if lastEpisodeGuid is null (first time) or if explicitly requested
          const forceUpdate = !feedConfig.lastEpisodeGuid || process.env.FORCE_UPDATE === 'true';

          if (checkResult.hasUpdates || forceUpdate) {
            if (forceUpdate && !checkResult.hasUpdates) {
              logger.info(`Forcing update for ${feedName} (first time or forced)`);
            } else {
              logger.info(`New episodes found in ${feedName}, generating playlist`);
            }

            // Generate playlist from RSS feed
            const playlistResult = await rssPlaylistGenerator.generatePlaylistFromRSS(feedConfig);

            if (!playlistResult.success) {
              throw new Error(`Failed to generate playlist for ${feedName}`);
            }

            logger.info(`Successfully updated playlist: ${playlistResult.episodeCount} episodes`);
            logger.info(`Latest episode: ${playlistResult.lastEpisode}`);
            return 'updated';
          }

          logger.info(`No new episodes in ${feedName}`);
          return 'no-updates';
        }, {
          retries: FEED_RETRIES,
          delayMs: FEED_RETRY_DELAY_MS,
          shouldRetry: (error) => !isAccessError(error),
          onRetry: (error, attempt) => {
            logger.warn(`Retry ${attempt}/${FEED_RETRIES} for ${feedName} after error: ${error.message}`);
          }
        });

        if (outcome === 'updated') {
          updatedCount++;
        }
        processedCount++;

      } catch (error) {
        emitWorkflowWarning(feedName, error);

        if (isAccessError(error)) {
          logger.warn(`Access denied or feed not found for ${feedName}: ${error.message}`);
          logger.warn(`Skipping this feed (non-fatal error)`);
          // Don't increment error count for access issues
        } else {
          logger.error(`Error processing feed ${feedName} (after ${FEED_RETRIES} retries):`, error);
          logger.error(`Error stack:`, error.stack);
          console.error(`Error processing feed ${feedName}:`, error);
          errorCount++;
        }
      }
    }
    
    // Aggregate the LocalBitcoiners community podcastL playlist. This is NOT a
    // single RSS feed (it reads a JSON directory API), so it runs as its own
    // step here rather than via FEEDS.md discovery. Same non-fatal policy as
    // the feeds above: transient errors are retried, 403/404 are skipped, and a
    // failure surfaces a workflow warning instead of failing the run.
    try {
      logger.info('Generating LocalBitcoiners community playlist');
      const aggregator = new CommunityPlaylistAggregator(fullConfig);
      const communityResult = await withRetry(() => aggregator.generate(), {
        retries: FEED_RETRIES,
        delayMs: FEED_RETRY_DELAY_MS,
        shouldRetry: (error) => !isAccessError(error),
        onRetry: (error, attempt) => {
          logger.warn(`Retry ${attempt}/${FEED_RETRIES} for community playlist after error: ${error.message}`);
        }
      });
      logger.info(`Community playlist updated: ${communityResult.episodeCount} episode(s) (${communityResult.newCount} new)`);
      updatedCount++;
      processedCount++;
    } catch (error) {
      emitWorkflowWarning('community-playlist', error);
      if (isAccessError(error)) {
        logger.warn(`Access denied or not found for community playlist: ${error.message}`);
        logger.warn('Skipping community playlist (non-fatal error)');
      } else {
        logger.error(`Error generating community playlist (after ${FEED_RETRIES} retries):`, error);
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
          // Update existing feed with new values including lastChecked and lastEpisodeGuid
          updatedFeeds[existingIndex] = feed;
        } else {
          // Add new feed
          updatedFeeds.push(feed);
        }
      });
      
      feedsConfig.rssFeeds = updatedFeeds;
    }
    
    // Save the updated feed config (with lastChecked and lastEpisodeGuid) after all feeds processed
    saveFeedsConfig();
    
    logger.info(`Daily update complete: ${updatedCount} playlist(s) updated, ${processedCount} feed(s) processed, ${errorCount} error(s)`);

    // Transient per-feed errors don't fail the run: as long as at least one feed
    // was processed cleanly, exit 0 (failed feeds are surfaced as workflow
    // warnings and retried on the next scheduled run). Fail only when every
    // feed errored.
    const success = errorCount === 0 || processedCount > 0;

    return {
      success: success,
      updated: updatedCount,
      processed: processedCount,
      errors: errorCount
    };
    
  } catch (error) {
    logger.error('Error during daily feed update:', error);
    logger.error('Error stack:', error.stack);
    console.error('Error during daily feed update:', error);
    console.error('Error stack:', error.stack);
    return {
      success: false,
      updated: 0,
      errors: 1,
      error: error.message || 'Unknown error',
      errorStack: error.stack
    };
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
      if (result.errors > 0) {
        logger.warn(`Daily update completed with ${result.errors} feed error(s) - treated as non-fatal, see workflow warnings`);
      }
      logger.info('Daily update completed successfully');
      process.exit(0);
    } else {
      logger.error(`Daily update failed: all feeds errored (${result.errors || 0} error(s))`);
      process.exit(1);
    }
  })
  .catch(error => {
    logger.error('Fatal error during daily update:', error);
    logger.error('Error stack:', error.stack);
    console.error('Fatal error:', error);
    process.exit(1);
  });


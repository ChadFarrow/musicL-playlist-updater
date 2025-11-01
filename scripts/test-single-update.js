#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
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
  enableGitHubSync: false, // DISABLED for dry-run - won't actually update
  
  // Logging
  logLevel: config.logging?.level || 'info'
};

async function dryRunUpdate(playlistId) {
  try {
    if (!fullConfig.githubToken) {
      logger.error('GitHub token required for dry-run testing');
      return false;
    }

    logger.info(`\n🧪 Dry-run update for: ${playlistId}`);
    logger.info(`   (No files will be updated in GitHub)\n`);

    const githubSync = new GitHubSync(
      fullConfig.githubToken,
      fullConfig.githubRepoOwner,
      fullConfig.githubRepoName,
      fullConfig.githubRepoBranch
    );

    // Get existing playlist
    const existingContent = await githubSync.getFileContent(`docs/${playlistId}.xml`);
    if (!existingContent) {
      logger.error(`Playlist not found: ${playlistId}`);
      return false;
    }

    // Save existing for comparison
    writeFileSync(`test-playlists/${playlistId}-BEFORE.xml`, existingContent, 'utf8');
    logger.info(`  💾 Saved existing playlist to: test-playlists/${playlistId}-BEFORE.xml`);

    // Detect format
    const hasItemTags = /<item[^>]*>/.test(existingContent);
    const existingFormat = hasItemTags ? 'full-items' : 'remoteItem-only';
    logger.info(`  📋 Existing format: ${existingFormat}`);

    // Get RSS feed URL
    const sourceFeedMatch = existingContent.match(/<podcast:txt\s+purpose=["']source-(?:feed|rss)["']>([^<]+)<\/podcast:txt>/i);
    const rssUrl = sourceFeedMatch ? sourceFeedMatch[1].trim() : null;
    
    const feedConfig = feedsConfig.rssFeeds?.find(f => f.playlistId === playlistId);
    const feedRssUrl = feedConfig?.rssUrl || rssUrl;

    if (!feedRssUrl) {
      logger.error(`  ❌ No RSS feed found for ${playlistId}`);
      return false;
    }

    logger.info(`  🔗 RSS Feed: ${feedRssUrl}`);

    // Create feed config for update
    const testFeedConfig = {
      ...feedConfig,
      playlistId: playlistId,
      rssUrl: feedRssUrl,
      playlistTitle: feedConfig?.playlistTitle || playlistId,
      playlistDescription: feedConfig?.playlistDescription || `Test: ${playlistId}`,
      playlistAuthor: feedConfig?.playlistAuthor || 'ChadFarrow',
      playlistImageUrl: feedConfig?.playlistImageUrl || '',
      enabled: true,
      lastChecked: null,
      lastEpisodeGuid: null
    };

    // Generate updated playlist (with sync disabled)
    const rssPlaylistGenerator = new RSSPlaylistGenerator({
      ...fullConfig,
      enableGitHubSync: false // Don't actually sync to GitHub
    });

    // Force format detection by setting githubSync manually
    rssPlaylistGenerator.githubSync = githubSync;

    logger.info(`  ⏳ Fetching RSS feed and generating playlist...`);
    const updateResult = await rssPlaylistGenerator.generatePlaylistFromRSS(testFeedConfig);

    if (!updateResult.success) {
      logger.error(`  ❌ Failed to generate playlist: ${updateResult.error}`);
      return false;
    }

    // Read generated playlist
    const generatedContent = readFileSync(updateResult.localPath, 'utf8');
    
    // Save generated for comparison
    writeFileSync(`test-playlists/${playlistId}-AFTER.xml`, generatedContent, 'utf8');
    logger.info(`  💾 Saved generated playlist to: test-playlists/${playlistId}-AFTER.xml`);

    // Verify format preservation
    const generatedHasItems = /<item[^>]*>/.test(generatedContent);
    const generatedFormat = generatedHasItems ? 'full-items' : 'remoteItem-only';

    logger.info(`  ✨ Generated format: ${generatedFormat}`);
    logger.info(`  📊 Episodes: ${updateResult.episodeCount}`);
    logger.info(`  🎵 Latest episode: ${updateResult.lastEpisode}`);

    if (existingFormat !== generatedFormat) {
      logger.error(`  ❌ Format mismatch! Existing: ${existingFormat}, Generated: ${generatedFormat}`);
      return false;
    }

    logger.info(`  ✅ Format preserved correctly!`);
    logger.info(`\n  📁 Comparison files:`);
    logger.info(`     Before: test-playlists/${playlistId}-BEFORE.xml`);
    logger.info(`     After:  test-playlists/${playlistId}-AFTER.xml`);
    logger.info(`\n  💡 Review the generated file to verify the update looks correct.`);
    logger.info(`  💡 If satisfied, you can run the full workflow safely.\n`);

    return true;

  } catch (error) {
    logger.error(`  ❌ Dry-run failed:`, error);
    return false;
  }
}

async function main() {
  const playlistId = process.argv[2];
  if (!playlistId) {
    logger.error('Usage: node scripts/test-single-update.js <playlist-id>');
    logger.error('Example: node scripts/test-single-update.js HGH-music-playlist');
    process.exit(1);
  }

  // Ensure test directory exists
  try {
    mkdirSync('./test-playlists', { recursive: true });
  } catch (error) {
    // Directory might already exist
  }

  const result = await dryRunUpdate(playlistId);

  if (result) {
    logger.info(`✅ Dry-run completed successfully for ${playlistId}`);
    process.exit(0);
  } else {
    logger.error(`❌ Dry-run failed for ${playlistId}`);
    process.exit(1);
  }
}

main();


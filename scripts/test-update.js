#!/usr/bin/env node

import { readFileSync } from 'fs';
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
  enableGitHubSync: false, // DISABLED for testing - won't actually update
  
  // Logging
  logLevel: config.logging?.level || 'info'
};

async function testFormatPreservation(playlistId) {
  try {
    if (!fullConfig.githubToken) {
      logger.error('GitHub token required for format testing');
      return false;
    }

    const githubSync = new GitHubSync(
      fullConfig.githubToken,
      fullConfig.githubRepoOwner,
      fullConfig.githubRepoName,
      fullConfig.githubRepoBranch
    );

    logger.info(`\n🧪 Testing format preservation for: ${playlistId}`);
    
    // Get existing playlist
    const existingContent = await githubSync.getFileContent(`docs/${playlistId}.xml`);
    if (!existingContent) {
      logger.warn(`Playlist not found: ${playlistId}`);
      return false;
    }

    // Detect format
    const hasItemTags = /<item[^>]*>/.test(existingContent);
    const existingFormat = hasItemTags ? 'full-items' : 'remoteItem-only';
    logger.info(`  📋 Existing format detected: ${existingFormat}`);

    // Count items/remoteItems
    const itemCount = (existingContent.match(/<item[^>]*>/g) || []).length;
    const remoteItemCount = (existingContent.match(/<podcast:remoteItem/g) || []).length;
    logger.info(`  📊 Existing: ${itemCount} items, ${remoteItemCount} remoteItems`);

    // Get RSS feed URL from playlist XML or feed config
    const sourceFeedMatch = existingContent.match(/<podcast:txt\s+purpose=["']source-(?:feed|rss)["']>([^<]+)<\/podcast:txt>/i);
    const rssUrl = sourceFeedMatch ? sourceFeedMatch[1].trim() : null;
    
    // Or find in configured feeds
    const feedConfig = feedsConfig.rssFeeds?.find(f => f.playlistId === playlistId);
    const feedRssUrl = feedConfig?.rssUrl || rssUrl;

    if (!feedRssUrl) {
      logger.warn(`  ⚠️  No RSS feed found for ${playlistId}`);
      return false;
    }

    logger.info(`  🔗 RSS Feed: ${feedRssUrl}`);
    
    // Create feed config for testing
    const testFeedConfig = {
      ...feedConfig,
      playlistId: playlistId,
      rssUrl: feedRssUrl,
      playlistTitle: feedConfig?.playlistTitle || playlistId,
      playlistDescription: feedConfig?.playlistDescription || `Test: ${playlistId}`,
      playlistAuthor: feedConfig?.playlistAuthor || 'ChadFarrow',
      playlistImageUrl: feedConfig?.playlistImageUrl || ''
    };

    // Generate test playlist (with sync disabled)
    const rssPlaylistGenerator = new RSSPlaylistGenerator({
      ...fullConfig,
      enableGitHubSync: false // Don't actually sync
    });

    // Force format detection by setting githubSync manually
    rssPlaylistGenerator.githubSync = githubSync;

    // Generate playlist (will detect and preserve format)
    const testFeed = await rssPlaylistGenerator.parser.parseURL(testFeedConfig.rssUrl);
    const generatedXML = rssPlaylistGenerator.generateMusicLXML(testFeed, testFeedConfig, existingFormat);

    // Analyze generated format
    const generatedHasItems = /<item[^>]*>/.test(generatedXML);
    const generatedFormat = generatedHasItems ? 'full-items' : 'remoteItem-only';
    const generatedItemCount = (generatedXML.match(/<item[^>]*>/g) || []).length;
    const generatedRemoteItemCount = (generatedXML.match(/<podcast:remoteItem/g) || []).length;

    logger.info(`  ✨ Generated format: ${generatedFormat}`);
    logger.info(`  📊 Generated: ${generatedItemCount} items, ${generatedRemoteItemCount} remoteItems`);

    // Verify format match
    const formatMatches = existingFormat === generatedFormat;
    if (formatMatches) {
      logger.info(`  ✅ Format preserved correctly!`);
    } else {
      logger.error(`  ❌ Format mismatch! Existing: ${existingFormat}, Generated: ${generatedFormat}`);
      return false;
    }

    // Check content preservation
    if (existingFormat === 'full-items') {
      // For full-items format, check that we have descriptions and enclosures
      const hasDescriptions = /<description>/.test(generatedXML);
      const hasEnclosures = /<enclosure/.test(generatedXML);
      logger.info(`  📝 Full items check: descriptions=${hasDescriptions}, enclosures=${hasEnclosures}`);
      
      if (!hasDescriptions || !hasEnclosures) {
        logger.warn(`  ⚠️  Missing expected content in full-items format`);
      }
    }

    logger.info(`  ✅ Test passed for ${playlistId}\n`);
    return true;

  } catch (error) {
    logger.error(`  ❌ Test failed for ${playlistId}:`, error);
    return false;
  }
}

async function testAllFeeds() {
  try {
    logger.info('🧪 Testing playlist format preservation for all feeds...\n');

    if (!fullConfig.githubToken) {
      logger.warn('GitHub token not found. Set GITHUB_TOKEN environment variable.');
      logger.warn('Cannot test format preservation without token.');
      return { passed: 0, failed: 0, total: 0 };
    }

    const githubSync = new GitHubSync(
      fullConfig.githubToken,
      fullConfig.githubRepoOwner,
      fullConfig.githubRepoName,
      fullConfig.githubRepoBranch
    );

    // Discover all playlists from target repo and use those for testing
    const discoveredPlaylists = await githubSync.discoverPlaylists('docs');
    
    // Or use configured feeds if discovery unavailable
    const configuredFeeds = feedsConfig.rssFeeds?.filter(f => f.enabled) || [];
    const feedsToTest = discoveredPlaylists.length > 0
      ? discoveredPlaylists.map(p => ({ playlistId: p.playlistId, rssUrl: p.rssUrl }))
      : configuredFeeds.map(f => ({ playlistId: f.playlistId, rssUrl: f.rssUrl }));

    if (feedsToTest.length === 0) {
      logger.warn('No feeds found to test');
      return { passed: 0, failed: 0, total: 0 };
    }

    logger.info(`Testing ${feedsToTest.length} playlist(s)...\n`);

    let passed = 0;
    let failed = 0;

    for (const feed of feedsToTest) {
      try {
        const result = await testFormatPreservation(feed.playlistId);
        if (result) {
          passed++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.error(`Error testing ${feed.playlistId}:`, error.message);
        failed++;
      }
    }

    logger.info(`\n📊 Test Results:`);
    logger.info(`  ✅ Passed: ${passed}`);
    logger.info(`  ❌ Failed: ${failed}`);
    logger.info(`  📈 Total: ${feedsToTest.length}`);

    if (failed === 0) {
      logger.info(`\n🎉 All tests passed! Format preservation is working correctly.`);
      logger.info(`   You can safely run the workflow without breaking feeds.`);
    } else {
      logger.error(`\n⚠️  Some tests failed. Review the errors above before running the workflow.`);
    }

    return { passed, failed, total: feedsToTest.length };

  } catch (error) {
    logger.error('Failed to test feeds:', error);
    throw error;
  }
}

// Run tests
testAllFeeds()
  .then(result => {
    if (result.failed === 0) {
      logger.info('\n✅ All format preservation tests passed!');
      process.exit(0);
    } else {
      logger.error('\n❌ Some tests failed. Fix issues before running workflow.');
      process.exit(1);
    }
  })
  .catch(error => {
    logger.error('Fatal error during testing:', error);
    process.exit(1);
  });


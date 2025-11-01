#!/usr/bin/env node

import { readFileSync } from 'fs';
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

// Build configuration
const fullConfig = {
  githubToken: process.env.GITHUB_TOKEN || config.github?.token,
  githubRepoOwner: config.github?.repoOwner || 'ChadFarrow',
  githubRepoName: config.github?.repoName || 'chadf-musicl-playlists',
  githubRepoBranch: config.github?.repoBranch || 'main'
};

async function restorePlaylistsFromCommit(commitSha) {
  try {
    if (!fullConfig.githubToken) {
      logger.error('GitHub token not found. Set GITHUB_TOKEN environment variable or in config.json');
      process.exit(1);
    }

    logger.info(`Restoring playlists from commit ${commitSha}...`);
    logger.info(`Target repository: ${fullConfig.githubRepoOwner}/${fullConfig.githubRepoName}`);

    const githubSync = new GitHubSync(
      fullConfig.githubToken,
      fullConfig.githubRepoOwner,
      fullConfig.githubRepoName,
      fullConfig.githubRepoBranch
    );

    // List all XML files in docs/ from the specified commit
    logger.info(`Fetching playlist files from commit ${commitSha}...`);
    const files = await githubSync.listDirectory('docs', commitSha);
    
    if (files.length === 0) {
      logger.warn(`No XML files found in commit ${commitSha}`);
      return;
    }

    logger.info(`Found ${files.length} playlist file(s) to restore:`);
    files.forEach(file => {
      logger.info(`  - ${file.name}`);
    });

    // Restore all playlist files
    const filePaths = files.map(file => file.path);
    const result = await githubSync.restoreFilesFromCommit(
      commitSha,
      filePaths,
      'Restore playlists from known good commit'
    );

    logger.info(`\nRestoration complete:`);
    logger.info(`  ✅ Restored: ${result.restored.length} file(s)`);
    if (result.errors.length > 0) {
      logger.error(`  ❌ Errors: ${result.errors.length} file(s)`);
      result.errors.forEach(({ filePath, error }) => {
        logger.error(`    - ${filePath}: ${error}`);
      });
    }

    if (result.restored.length > 0) {
      logger.info(`\nSuccessfully restored ${result.restored.length} playlist file(s) from commit ${commitSha}`);
      logger.info('Files have been restored to the target repository');
    }

  } catch (error) {
    logger.error('Failed to restore playlists from commit:', error);
    process.exit(1);
  }
}

// Get commit SHA from command line argument
const commitSha = process.argv[2];

if (!commitSha) {
  logger.error('Usage: node scripts/restore-from-commit.js <commit-sha>');
  logger.error('Example: node scripts/restore-from-commit.js 153be3251ef659a8ba66769dc7e303fbbd7ccee0');
  process.exit(1);
}

// Run restoration
restorePlaylistsFromCommit(commitSha)
  .then(() => {
    logger.info('Restore operation completed');
    process.exit(0);
  })
  .catch(error => {
    logger.error('Fatal error during restore:', error);
    process.exit(1);
  });


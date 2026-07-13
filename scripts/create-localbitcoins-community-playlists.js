import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';
import { CommunityPlaylistAggregator } from '../src/services/CommunityPlaylistAggregator.js';
import { logger } from '../src/utils/logger.js';

/**
 * Standalone CLI to (re)generate the LocalBitcoiners community `podcastL`
 * playlist and publish it to the target repo. Also runs automatically as a
 * step in scripts/daily-update.js.
 *
 * Options (CLI flag wins over env var):
 *   --url=<page>  / LBC_DIRECTORY_URL  community-boosts API URL (default in aggregator)
 *   --out=<file>  / LBC_OUTPUT_PATH    local output XML path
 *   --dry-run     / LBC_DRY_RUN=1      print the XML instead of writing/pushing
 *
 * Requires network access to localbitcoiners.com. GitHub sync additionally
 * requires GITHUB_TOKEN (skipped automatically in --dry-run).
 */

function parseArgs(argv) {
  const opts = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) opts[m[1]] = m[2] === undefined ? true : m[2];
  }
  return opts;
}

const ARGS = parseArgs(process.argv.slice(2));

// Load optional config.json (same tolerant pattern as daily-update.js).
let config = {};
try {
  config = JSON.parse(readFileSync('./config.json', 'utf8'));
  logger.info('Loaded config.json');
} catch (error) {
  if (error.code !== 'ENOENT') {
    logger.error('Failed to load config.json:', error);
    process.exit(1);
  }
  logger.info('config.json not found, using environment variables and defaults');
}

const fullConfig = {
  playlistsDir: config.storage?.playlistsDir || './playlists',
  githubToken: process.env.GITHUB_TOKEN || config.github?.token,
  githubRepoOwner: config.github?.repoOwner || 'ChadFarrow',
  githubRepoName: config.github?.repoName || 'chadf-musicl-playlists',
  githubRepoBranch: config.github?.repoBranch || 'main',
  enableGitHubSync: config.github?.enableSync !== false
};

const dryRun = Boolean(ARGS['dry-run'] || process.env.LBC_DRY_RUN);

// In dry-run there is nothing to push, so don't require/attempt GitHub access.
if (dryRun) {
  fullConfig.enableGitHubSync = false;
}

// Local convenience: if no token was provided (env/config) but the GitHub CLI
// is authenticated, borrow its token so `npm run create-localbitcoins-playlists`
// just works locally. CI always sets GITHUB_TOKEN, so this never runs there.
if (!dryRun && fullConfig.enableGitHubSync && !fullConfig.githubToken) {
  try {
    const ghToken = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
    if (ghToken) {
      fullConfig.githubToken = ghToken;
      logger.info('No GITHUB_TOKEN set; using token from authenticated gh CLI');
    }
  } catch {
    logger.warn('No GITHUB_TOKEN set and gh CLI unavailable/unauthenticated; will write local file only');
  }
}

const opts = {
  apiUrl: ARGS.url || process.env.LBC_DIRECTORY_URL || undefined,
  outputPath: ARGS.out
    ? resolve(ARGS.out)
    : process.env.LBC_OUTPUT_PATH
    ? resolve(process.env.LBC_OUTPUT_PATH)
    : undefined,
  dryRun
};

const aggregator = new CommunityPlaylistAggregator(fullConfig, opts);

aggregator
  .generate()
  .then((result) => {
    if (!result.dryRun) {
      logger.info(`Community playlist complete: ${result.episodeCount} episode(s) (${result.newCount} new)`);
    }
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Failed to generate community playlist:', error);
    console.error('Error:', error.message);
    process.exit(1);
  });

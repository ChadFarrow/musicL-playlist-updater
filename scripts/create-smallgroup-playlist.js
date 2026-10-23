import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';
import { SmallGroupPlaylistAggregator } from '../src/services/SmallGroupPlaylistAggregator.js';
import { logger } from '../src/utils/logger.js';

/**
 * Standalone CLI to (re)generate the Small Group Shows `podcastL` playlist
 * (latest episodes from every show on smallgroupscoop.com/shows) and publish it
 * to the target repo. Also runs automatically as a step in
 * scripts/daily-update.js.
 *
 * Options (CLI flag wins over env var):
 *   --out=<file>  / SGS_OUTPUT_PATH  local output XML path
 *   --dry-run     / SGS_DRY_RUN=1    print the XML instead of writing/pushing
 *
 * Requires network access to smallgroupscoop.com and the shows' feeds. GitHub
 * sync additionally requires GITHUB_TOKEN (skipped automatically in --dry-run).
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
  enableGitHubSync: config.github?.enableSync !== false,
  // Same PodPing settings as daily-update.js, so a manual publish pings too.
  podping: {
    enabled: config.podping?.enabled !== false,
    timeout: config.podping?.timeout || 10000,
    hiveNode: config.podping?.hiveNode || 'https://api.hive.blog',
    hiveUsername: process.env.HIVE_USERNAME || config.podping?.hiveUsername || '',
    hivePostingKey: process.env.HIVE_POSTING_KEY || config.podping?.hivePostingKey || ''
  }
};

const dryRun = Boolean(ARGS['dry-run'] || process.env.SGS_DRY_RUN);

// In dry-run there is nothing to push, so don't require/attempt GitHub access.
if (dryRun) {
  fullConfig.enableGitHubSync = false;
}

// Local convenience: if no token was provided (env/config) but the GitHub CLI
// is authenticated, borrow its token so `npm run create-smallgroup-playlist`
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
  outputPath: ARGS.out
    ? resolve(ARGS.out)
    : process.env.SGS_OUTPUT_PATH
    ? resolve(process.env.SGS_OUTPUT_PATH)
    : undefined,
  dryRun
};

const aggregator = new SmallGroupPlaylistAggregator(fullConfig, opts);

aggregator
  .generate()
  .then((result) => {
    for (const { name, reason } of result.stale) logger.warn(`Feed down, kept previous episodes: ${name} (${reason})`);
    for (const { name, reason } of result.skipped) logger.warn(`Skipped: ${name} (${reason})`);
    for (const { name, feedUrl } of result.discovered) logger.info(`Discovered new show: ${name} -> ${feedUrl}`);
    for (const warning of result.warnings) logger.warn(warning);
    if (!result.dryRun) {
      logger.info(
        result.changed
          ? `Small Group playlist complete: ${result.episodeCount} episode(s) from ${result.showCount} show(s)`
          : 'Small Group playlist unchanged (no new episodes)'
      );
    }
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Failed to generate Small Group playlist:', error);
    console.error('Error:', error.message);
    process.exit(1);
  });

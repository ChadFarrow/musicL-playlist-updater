# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MusicL Playlist Updater is an automated RSS feed monitoring and musicL (podcast) playlist generation system. It watches RSS feeds for new episodes and generates musicL-compliant XML playlists with Podcasting 2.0 features (remote items, Lightning Network value tags). Playlists are synced to a separate GitHub repo (`chadf-musicl-playlists`) via the GitHub API.

## Commands

```bash
# Development
npm run dev              # Watch mode with auto-reload
npm start                # Show CLI help
npm test                 # Run tests (Node test runner for src/**/*.test.js)

# CLI operations
npm start start          # Start the automatic monitor/scheduler
npm start status         # Check system status
npm start discover       # Discover playlists in target repo's docs folder
npm start list-feeds     # List configured feeds
npm start check-feed <id>  # Manual check single feed
npm start add-feed <name> <url>  # Add new RSS feed

# Playlist generation (standalone scripts)
npm run update           # Update playlists (music-playlist-updater.js)
npm run update-all       # Update all playlists
npm run build            # Build playlists (build-music-playlist.js)
npm run rebuild          # Rebuild all playlists

# Daily update (used by GitHub Actions CI)
node scripts/daily-update.js
```

## Architecture

### Entry Point & CLI

`src/index.js` - Contains `MusicLPlaylistUpdater` class and CLI dispatch (`process.argv` switch). All CLI commands route through this file.

### Three Operating Modes

Set in `src/config/feeds.json` under `settings.monitorMode`:

- **`rss`** - Monitor RSS feeds directly, detect new episodes by GUID comparison, generate full-item XML playlists
- **`playlist`** - Monitor existing GitHub playlists for changes using ETags
- **`rss-to-playlist`** (current production mode) - Parse RSS feeds, extract `podcast:valueTimeSplit` / `podcast:remoteItem` tags from raw XML, generate simplified remoteItem-only musicL playlists

### Core Services (`src/services/`)

- **`Scheduler.js`** - Cron-based job orchestration via `node-cron`. Creates per-feed jobs based on `checkIntervalMinutes`. Delegates to the appropriate service based on `monitorMode`.
- **`RSSMonitor.js`** - Parses RSS with Podcasting 2.0 custom fields (`podcast:remoteItem`, `podcast:value`). Detects new episodes by comparing GUIDs against `lastEpisodeGuid`. Reads/writes `feeds.json` directly.
- **`RSSPlaylistGenerator.js`** - The main playlist generator for `rss-to-playlist` mode. Fetches raw RSS XML and uses regex to extract `feedGuid`/`itemGuid` pairs from `podcast:valueTimeSplit` tags in document order. Merges with existing playlist content from GitHub. Handles two output formats: `full-items` (complete RSS items) and `remoteItem-only` (simplified format with `podcast:txt` episode markers).
- **`PlaylistUpdater.js`** - Generates full-item musicL XML playlists (used in `rss` mode). Simpler than RSSPlaylistGenerator.
- **`GitHubSync.js`** - GitHub Contents API integration. Handles file read/write/list operations on the target repo. Also parses `FEEDS.md` from the target repo to discover which playlists to manage, and parses playlist XML to extract `podcast:txt purpose="source-feed"` URLs.
- **`PlaylistDiscovery.js`** - Discovers playlists by listing XML files in the target repo's `/docs` folder via GitHub API.
- **`PlaylistMonitor.js`** - Monitors playlist changes from GitHub using ETags (used in `playlist` mode).
- **`PodPing.js`** - Broadcasts `podping` custom_json operations on the Hive blockchain via `@hiveio/dhive` to notify podcast aggregators of feed updates.

### Data Flow (rss-to-playlist mode)

```
RSS Feed → RSSPlaylistGenerator.checkFeedForUpdates()
         → RSSPlaylistGenerator.generatePlaylistFromRSS()
           → Fetch raw RSS XML + parse with rss-parser
           → Extract feedGuid/itemGuid pairs from valueTimeSplit tags
           → Merge with existing playlist from GitHub (GitHubSync.getFileContent)
           → Generate musicL XML with podcast:remoteItem entries
           → Save locally to ./playlists/{playlistId}.xml
           → GitHubSync.updateFile() to target repo docs/{playlistId}.xml
           → PodPing.sendNotification() to Hive blockchain
```

### Daily Update Script

`scripts/daily-update.js` - Used by GitHub Actions CI. Loads feeds from `FEEDS.md` in the target repo (with fallback to `feeds.json`), checks each for updates, generates playlists, and saves updated config. This is the primary production entry point.

## Configuration

**Feed Config**: `src/config/feeds.json`
- `rssFeeds[]` - Array of feed objects with `id`, `rssUrl`, `playlistId`, `checkIntervalMinutes`, `lastEpisodeGuid`, `lastChecked`, and playlist metadata
- `playlists[]` - Used in `playlist` monitor mode
- `settings.monitorMode` - Determines which service handles updates (`rss`, `playlist`, or `rss-to-playlist`)
- `settings.productionMode` - Production flag

**Config Loading Order**: Environment variables → `./config.json` → hardcoded defaults → `src/config/feeds.json` for feed/monitor settings

**Environment Variables** (see `env.example`):
- `GITHUB_TOKEN` - GitHub API access for the target playlist repo
- `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME` - Target repo (`ChadFarrow/chadf-musicl-playlists`)
- `HIVE_USERNAME`, `HIVE_POSTING_KEY` - Hive blockchain credentials for PodPing
- `CHECK_INTERVAL_MINUTES` - Default check frequency (30)
- `LOG_LEVEL` - Winston log level (`error`, `warn`, `info`, `debug`)
- `FORCE_UPDATE` - Skip GUID comparison, regenerate all playlists

## Key Details

- ES Module project (`"type": "module"`) requiring Node >= 18.0.0
- No test files currently exist (test glob `src/**/*.test.js` matches nothing)
- Playlists output locally to `./playlists/{playlistId}.xml` (gitignored), then synced to target repo `docs/` via GitHub Contents API
- The `playlists/` directory is a local temp workspace only — playlist XML files are NOT tracked in this repo, they live exclusively in the target repo (`chadf-musicl-playlists/docs/`)
- Only `feeds.json` changes are git-committed in CI; playlist XML files are pushed to the separate target repo via API
- Logs written to `./logs/combined.log` and `./logs/error.log` (Winston)
- GitHub Actions workflow (`.github/workflows/daily-feed-update.yml`) runs daily at 7 AM UTC (2 AM EST)
- RSSMonitor normalizes both `feeds` and `rssFeeds` keys in config
- Generated playlists use `<podcast:medium>musicL</podcast:medium>` and group tracks by episode using `<podcast:txt purpose="episode">` markers
- The `FEEDS.md` file in the target repo serves as the source of truth for which playlists to manage; `feeds.json` is the fallback

## Adding a New Feed

When adding a new feed, three things must be done for the daily CI to pick it up:

1. **Add feed entry to `src/config/feeds.json`** — with `rssUrl`, `playlistId`, playlist metadata, and `lastEpisodeGuid: null`
2. **Add entry to `FEEDS.md` in the target repo** (`chadf-musicl-playlists`) — the daily script reads this as the source of truth
3. **Seed an initial playlist XML in the target repo** (`docs/{playlistId}.xml`) — the daily script's `discoverPlaylists()` only matches feeds that already have an XML file in `docs/`, and it requires a `<podcast:txt purpose="source-feed">` tag in the XML to extract the RSS URL. Without this, the feed silently gets skipped even if it's in `FEEDS.md`

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

# Community podcastL playlist aggregator (optional; runs automatically in daily CI)
npm run create-localbitcoins-playlists            # Regenerate + publish now (only if the playlist XML changed)
node scripts/create-localbitcoins-community-playlists.js --dry-run   # Preview XML to stdout

# Small Group Shows podcastL playlist (optional; runs automatically in daily CI)
npm run create-smallgroup-playlist                # Regenerate + publish now (only if the playlist XML changed)
node scripts/create-smallgroup-playlist.js --dry-run   # Preview XML to stdout

# PodPing through the msp-podping-service pusher (needs PODPING_ENDPOINT_URL + PODPING_BEARER_TOKEN)
npm run test-podping -- <feed-url> --medium musicL   # Queue only (no_broadcast); add --broadcast to send to Hive

# Daily update (used by GitHub Actions CI)
node scripts/daily-update.js
```

## Architecture

### Entry Point & CLI

`src/index.js` - Contains `MusicLPlaylistUpdater` class and CLI dispatch (`process.argv` switch). All CLI commands route through this file. The `check-feed` command uses `RSSPlaylistGenerator` (same as daily CI) to ensure consistent remoteItem-only output.

### Three Operating Modes

Set in `src/config/feeds.json` under `settings.monitorMode`:

- **`rss`** - Monitor RSS feeds directly, detect new episodes by GUID comparison
- **`playlist`** - Monitor existing GitHub playlists for changes using ETags
- **`rss-to-playlist`** (current production mode) - Parse RSS feeds, extract `podcast:valueTimeSplit` / `podcast:remoteItem` tags from raw XML, generate remoteItem-only musicL playlists

All modes generate the same **remoteItem-only** playlist format (no full-items code path exists).

### Core Services (`src/services/`)

- **`Scheduler.js`** - Cron-based job orchestration via `node-cron`. Creates per-feed jobs based on `checkIntervalMinutes`. Delegates to the appropriate service based on `monitorMode`.
- **`RSSMonitor.js`** - Parses RSS with Podcasting 2.0 custom fields (`podcast:remoteItem`, `podcast:value`). Detects new episodes by comparing GUIDs against `lastEpisodeGuid`. Reads/writes `feeds.json` directly.
- **`RSSPlaylistGenerator.js`** - The main playlist generator. Used by both `rss-to-playlist` mode and `check-feed` CLI command. Fetches raw RSS XML and uses regex to extract `feedGuid`/`itemGuid` pairs from `podcast:valueTimeSplit` tags in document order. Merges with existing playlist content from GitHub. Always generates remoteItem-only format with `podcast:txt purpose="episode"` markers.
- **`PlaylistUpdater.js`** - Legacy service, no longer used by any active code path. Kept for reference only.
- **`GitHubSync.js`** - GitHub Contents API integration. Handles file read/write/list operations on the target repo. Also parses `FEEDS.md` from the target repo to discover which playlists to manage, and parses playlist XML to extract `podcast:txt purpose="source-feed"` URLs.
- **`PlaylistDiscovery.js`** - Discovers playlists by listing XML files in the target repo's `/docs` folder via GitHub API.
- **`PlaylistMonitor.js`** - Monitors playlist changes from GitHub using ETags (used in `playlist` mode).
- **`PodPing.js`** - Sends PodPings through the msp-podping-service pusher (ChadFarrow/msp-podping-service: Caddy bearer auth in front of podping-hivepinger, which writes PodPing 1.1, batches, dedups and broadcasts to Hive): `GET $PODPING_ENDPOINT_URL?url=…&reason=…&medium=…` with `Authorization: Bearer $PODPING_BEARER_TOKEN`, the same request MSP sends. musicL playlists ping as `medium=musicL` under the `refs/heads/<branch>` URL that Podcast Index and the publisher feed list (`podpingFeedUrl`). Before 2026-10-23 it signed Hive ops itself with custom_json id `podping` and `reasons`/`urls`, which no PodPing schema accepts, so no reader ever acted on one. Never throws; never logs the token.
- **`PodcastIndexNotify.js`** - After each push, calls PI's keyless `/hub/pubnotify?id=<piFeedId>` so PI re-crawls the playlist. By feed ID, never by URL: PI holds these feeds as `.../refs/heads/main/docs/...`, and a URL PI lacks may be added as a new feed. Never throws.

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
           → notifyPodcastIndex(piFeedId) — PI /hub/pubnotify, when the feed has a piFeedId
           → PodPing.sendNotification(refs/heads URL, musicL) → msp-podping-service pusher → Hive
```

### Daily Update Script

`scripts/daily-update.js` - Used by GitHub Actions CI. Loads feeds from `FEEDS.md` in the target repo (with fallback to `feeds.json`), checks each for updates, generates playlists, and saves updated config. This is the primary production entry point.

**Transient error tolerance**: Each feed's check/generation runs inside `withRetry` (`src/utils/retry.js`) — up to 2 retries, 10s apart. 403/404 access errors are not retried (treated as non-fatal skips). The run exits 0 as long as at least one feed processed cleanly; feeds that still fail after retries emit `::warning::` annotations on the Actions run instead of failing it. Exit 1 only when every feed errors or a fatal error occurs (unreadable config, etc.). Design doc: `docs/superpowers/specs/2026-07-03-transient-feed-error-tolerance-design.md`.

**Community playlist aggregator**: After the RSS feed loop, `daily-update.js` also runs `CommunityPlaylistAggregator` (`src/services/CommunityPlaylistAggregator.js`) as one extra step under the same non-fatal policy — so the community playlist refreshes automatically with the daily CI run; no manual invocation is needed. Unlike the RSS feeds, it is a *directory aggregator*: it pulls many shows' episodes from the `localbitcoiners.com/api/community-boosts` JSON API into a single **`podcastL`** playlist (`docs/localbitcoins-community-playlists.xml`), grow-only via merge with the existing file, with a stable hardcoded `<podcast:guid>`. Like the Small Group step, it pushes only when the built XML differs from the published file apart from `<pubDate>`/`<lastBuildDate>` (`sameApartFromBuildDates`, `src/utils/xml.js`); before 2026-10-23 it committed on every run. `FEEDS.md` lists it under podcastL for reference, but the RSS loop never takes it (see the ID filter below). It writes no `source-feed` tag: the API is not a feed, and boostmebitch downloads that URL — 4.3 MB of JSON — as the playlist's source show. Run standalone (optional, for an off-schedule refresh) via `npm run create-localbitcoins-playlists`; `--dry-run` prints XML to stdout (winston logs go to stderr, so `--dry-run > file.xml` captures clean XML). For local publishes the CLI wrapper auto-borrows a token from an authenticated `gh` CLI when `GITHUB_TOKEN` is unset (CI always sets it from `secrets.TOKEN`). Guide: `LOCALBITCOINERS-COMMUNITY-PLAYLIST.md`.

**Small Group Shows aggregator**: After the community playlist, `daily-update.js` runs `SmallGroupPlaylistAggregator` (`src/services/SmallGroupPlaylistAggregator.js`), which builds one flat **`podcastL`** playlist (`docs/smallgroup-shows-playlist.xml`) of the latest 10 episodes from every show listed on https://smallgroupscoop.com/shows/, newest first across all shows. It's rolling, not grow-only: each show's oldest episode drops out as new ones come in. The show list is read from that page every run, and shows that join or leave are picked up automatically. The site publishes no feed URLs, so feeds come from the verified `KNOWN_FEEDS` map in the service (add a show there if discovery picks the wrong feed), from the run state, or from best-effort discovery through the show's own site. Run state (episode dates and each show's feed) lives in the target repo at `state/smallgroup-shows-playlist.json`, outside `docs/`. The state is what lets a show whose feed is down keep its previous episodes, and what lets a broken shows page fall back to the last known list. The step only pushes when the built XML differs from the published file apart from its two build dates, so a channel change (artwork) ships without a new episode. It sends no PodPing (`SEND_PODPING = false`) while the playlist is kept out of Podcast Index, since a PodPing reader may add a feed it does not know. It has no outer retry, because each feed is already retried. Stale, skipped, and newly discovered shows surface as `::warning::`/`::notice::` annotations. `FEEDS.md` lists it under podcastL, but the RSS loop never takes it (ID filter below). It writes no `source-feed` tag — never add one: it would name a web page, which boostmebitch downloads as the playlist's source show. HTML is parsed with regexes: **don't add cheerio** while CI runs Node 18, because the locked cheerio needs Node ≥20.18.1 and `daily-update.js` imports every aggregator when it loads. Feed URL: `https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/smallgroup-shows-playlist.xml`. Guide: `SMALLGROUP-SHOWS-PLAYLIST.md`. Design: `docs/superpowers/specs/2026-10-23-smallgroup-shows-playlist-design.md`.

## Configuration

**Feed Config**: `src/config/feeds.json`
- `rssFeeds[]` - Array of feed objects with `id`, `rssUrl`, `playlistId`, `playlistGuid`, `checkIntervalMinutes`, `lastEpisodeGuid`, `lastChecked`, and playlist metadata. `playlistGuid` is the playlist's `<podcast:guid>`, its identity in Podcast Index, favorites and boostagrams — never change one. Each existing entry holds the guid Podcast Index has for that feed; until 2026-10-23 the generator minted a new guid on every build. `stablePlaylistGuid` (`RSSPlaylistGenerator.js`) picks it: configured, else the published file's, else a new one, and the generator writes the result back to the feed config so `feeds.json` keeps it. `piFeedId` is the playlist's Podcast Index feed ID, used to notify PI after a push; leave it out for a feed PI does not hold
- `playlists[]` - Used in `playlist` monitor mode
- `settings.monitorMode` - Determines which service handles updates (`rss`, `playlist`, or `rss-to-playlist`)
- `settings.productionMode` - Production flag

**Config Loading Order**: Environment variables → `./config.json` → hardcoded defaults → `src/config/feeds.json` for feed/monitor settings

**Environment Variables** (see `env.example`). In CI, `daily-feed-update.yml` maps the repo secrets `TOKEN` → `GITHUB_TOKEN`, `PODPING_ENDPOINT_URL` and `PODPING_BEARER_TOKEN`; the `HIVE_USERNAME`/`HIVE_POSTING_KEY` secrets are no longer read (since 2026-10-23):
- `GITHUB_TOKEN` - GitHub API access for the target playlist repo
- `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME` - Target repo (`ChadFarrow/chadf-musicl-playlists`)
- `PODPING_ENDPOINT_URL`, `PODPING_BEARER_TOKEN` - the msp-podping-service pusher URL (trailing slash) and its bearer token (`PODPING_SHARED_SECRET` on Railway). Test with `npm run test-podping -- <feed-url> --medium musicL`, which only queues (`no_broadcast`) unless given `--broadcast`
- `CHECK_INTERVAL_MINUTES` - Default check frequency (30)
- `LOG_LEVEL` - Winston log level (`error`, `warn`, `info`, `debug`)
- `FORCE_UPDATE` - Skip GUID comparison, regenerate all playlists

## Key Details

- ES Module project (`"type": "module"`) requiring Node >= 18.0.0
- Tests use the Node built-in test runner (`npm test` runs `src/**/*.test.js`), one file beside each module it pins: `src/utils/retry.test.js`, `src/utils/xml.test.js` (incl. `sameApartFromBuildDates`), `src/services/RSSPlaylistGenerator.test.js` (stable `playlistGuid`), `src/services/PodcastIndexNotify.test.js` (pubnotify by `piFeedId`), `src/services/PodPing.test.js` (the pusher request, `musicL` + refs/heads URL), `src/services/CommunityPlaylistAggregator.test.js` (no push when only dates change, no `source-feed`), `src/services/SmallGroupPlaylistAggregator.test.js`, and `src/services/GitHubSync.test.js` (`parseFeedsMarkdown` on the real FEEDS.md). Network calls are injected or stubbed; a test never reaches GitHub, PI or the pusher
- `@hiveio/dhive` is no longer imported anywhere (PodPing goes through the pusher since 2026-10-23). It stays in `package.json` because `node_modules/` is committed; removing it is its own change
- Playlists output locally to `./playlists/{playlistId}.xml` (gitignored), then synced to target repo `docs/` via GitHub Contents API
- The `playlists/` directory is a local temp workspace only — playlist XML files are NOT tracked in this repo, they live exclusively in the target repo (`chadf-musicl-playlists/docs/`)
- Only `feeds.json` changes are git-committed in CI; playlist XML files are pushed to the separate target repo via API
- Logs written to `./logs/combined.log` and `./logs/error.log` (Winston); `logs/` is gitignored (both files are untracked). The Winston console transport routes **all** levels to **stderr**, leaving stdout for actual program output (e.g. `--dry-run` XML) and GitHub Actions workflow commands (`::warning::` via direct `console.log`)
- GitHub Actions workflow (`.github/workflows/daily-feed-update.yml`) is scheduled daily at 7 AM UTC (2 AM EST), but GitHub starts it hours late: 11:23–14:21 UTC for the 8 runs of 2026-10-16 to 2026-10-23. `workflow_dispatch` runs it now; `force_update=true` rebuilds and pushes every musicL playlist (one commit, one PI notify and one PodPing each)
- RSSMonitor normalizes both `feeds` and `rssFeeds` keys in config
- Generated playlists use `<podcast:medium>musicL</podcast:medium>` and group tracks by episode using `<podcast:txt purpose="episode">` markers
- The `FEEDS.md` file in the target repo serves as the source of truth for which **musicL** playlists to manage (the podcastL entries it lists are dropped by `parseFeedsMarkdown`'s ID filter and run as their own steps); `feeds.json` is the fallback

## Adding a New Feed

When adding a new feed, three things must be done for the daily CI to pick it up:

1. **Add feed entry to `src/config/feeds.json`** — with `rssUrl`, `playlistId`, playlist metadata, and `lastEpisodeGuid: null`. Leave `playlistGuid` out: the first build keeps the seed playlist's `<podcast:guid>` (or mints one) and saves it. Add `piFeedId` once the feed is in Podcast Index
2. **Add entry to `FEEDS.md` in the target repo** (`chadf-musicl-playlists`) — the daily script reads this as the source of truth. **`parseFeedsMarkdown` (`GitHubSync.js`) keeps only IDs that contain `-music-playlist`, `-muic-playlist` or `-musicl-`**; any other ID (the podcastL playlists) is dropped without a log line
3. **Seed an initial playlist XML in the target repo** (`docs/{playlistId}.xml`) — the daily script's `discoverPlaylists()` only matches feeds that already have an XML file in `docs/`, and it requires a `<podcast:txt purpose="source-feed">` tag in the XML to extract the RSS URL. Without this, the feed silently gets skipped even if it's in `FEEDS.md`

**Important**: Use `npm start check-feed <id>` (with GitHub sync enabled) or the daily CI with `FORCE_UPDATE=true` to generate the seed playlist. Both use `RSSPlaylistGenerator` which always produces the correct remoteItem-only format. Never manually create seed playlists with `<item>` tags — there is no full-items code path and the system only extracts `<podcast:remoteItem>` entries from existing playlists.

# GitHub Actions Setup Guide

This guide explains how to set up and use the GitHub Actions workflow for automated daily RSS feed updates.

## Overview

The GitHub Actions workflow automatically:
1. **Reads FEEDS.md** from the target repository (`chadf-musicl-playlists/FEEDS.md`) to determine which feeds to update
2. **Discovers playlists** matching the IDs in FEEDS.md from `chadf-musicl-playlists/docs/`
3. **Extracts RSS feed URLs** from each playlist's XML (`<podcast:txt purpose="source-feed">` tags)
4. Checks all RSS feeds for new episodes
5. Updates playlists with new tracks
6. **Syncs updated playlists** directly to the target repository (`chadf-musicl-playlists/docs/`) via GitHub API
7. Only commits configuration changes (`src/config/feeds.json`) to the updater repository

The workflow runs **once per day at midnight UTC** and can also be triggered manually.

### FEEDS.md Feature

The workflow reads `FEEDS.md` from the target repository to determine which feeds should be updated:
- **FEEDS.md is the source of truth** - Lists all playlist IDs that should be updated
- **Auto-discovery** - Workflow discovers playlists in `docs/` and matches them to FEEDS.md entries
- **Automatic RSS extraction** - Each playlist's source RSS feed is extracted from its XML
- **Fallback to feeds.json** - If FEEDS.md is not found, falls back to configured feeds in `feeds.json`

## Prerequisites

- A GitHub repository with the playlist updater code
- Node.js 18+ compatible codebase
- RSS feeds configured in `src/config/feeds.json`

## Setup Instructions

### Step 1: Add GitHub Token Secret

You need to create a Personal Access Token (PAT) with repository write permissions for **both repositories**:
- The updater repository (`musicL-playlist-updater`) - for committing config changes
- The target repository (`chadf-musicl-playlists`) - for syncing playlist files

1. **Create a Personal Access Token:**
   - Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Click "Generate new token (classic)"
   - Give it a descriptive name (e.g., "Playlist Updater")
   - Select the `repo` scope (full control of private repositories)
   - Click "Generate token"
   - **Copy the token immediately** (you won't be able to see it again)

2. **Add the token as a repository secret:**
   - Go to your **updater** repository: `https://github.com/ChadFarrow/musicL-playlist-updater`
   - Navigate to: Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `TOKEN` (Note: `GITHUB_TOKEN` is reserved by GitHub, so use `TOKEN` instead)
   - Value: Paste your Personal Access Token
   - Click "Add secret"
   - **Important**: The same token will be used to access both repositories. Ensure it has write access to `chadf-musicl-playlists`.

### Step 2: Configure Feeds in FEEDS.md

**Important**: The workflow reads `FEEDS.md` from the target repository (`chadf-musicl-playlists/FEEDS.md`) to determine which feeds to update. The workflow will:

1. Read `FEEDS.md` from the target repository
2. Parse playlist IDs from the file (supports various markdown formats: bullet lists, numbered lists, tables, etc.)
3. Discover matching playlists in `chadf-musicl-playlists/docs/`
4. Extract RSS feed URLs from each playlist's XML
5. Update all discovered feeds

**To add a feed for automatic updates:**

1. Edit `FEEDS.md` in the `chadf-musicl-playlists` repository
2. Add the playlist ID (without `.xml` extension) in any of these formats:
   - Bullet list: `- HGH-music-playlist`
   - Numbered list: `1. ITDV-music-playlist`
   - Table row: `| HGH-music-playlist | ... |`
   - Plain text: `HGH-music-playlist`

3. Ensure the corresponding playlist XML file exists in `docs/` with a valid `<podcast:txt purpose="source-feed">` tag

**Note**: You can also configure feeds manually in `src/config/feeds.json` for custom settings (check intervals, enabled/disabled, etc.). The workflow will use FEEDS.md first, then fall back to `feeds.json` if FEEDS.md is unavailable.

**Example FEEDS.md format:**
```markdown
# Feeds to Update

- HGH-music-playlist
- ITDV-music-playlist
- IAM-music-playlist
- MMM-music-playlist
```

**Example feeds.json (for custom settings):**
```json
{
  "rssFeeds": [
    {
      "id": "homegrown-hits-feed",
      "name": "Homegrown Hits Podcast",
      "playlistId": "HGH-music-playlist",
      "enabled": true,
      "checkIntervalMinutes": 1440
      // RSS URL and metadata will be auto-discovered from playlist XML
    }
  ]
}
```

### Step 3: Push the Workflow File

The workflow file (`.github/workflows/daily-feed-update.yml`) should already be in your repository. If not:

```bash
git add .github/workflows/daily-feed-update.yml
git commit -m "Add GitHub Actions workflow for daily RSS feed updates"
git push
```

## How It Works

### Automatic Schedule

The workflow runs automatically:
- **Schedule**: Daily at midnight UTC (`0 0 * * *`)
- **Trigger**: Scheduled cron job
- **Runs on**: Ubuntu latest
- **Node version**: 18

### Manual Trigger

You can also trigger the workflow manually:

1. Go to your repository on GitHub
2. Click "Actions" tab
3. Select "Daily RSS Feed Update" workflow
4. Click "Run workflow" button
5. Select branch (usually `main`)
6. Click "Run workflow"

### Workflow Steps

1. **Checkout repository** - Gets the latest code from the updater repository
2. **Setup Node.js** - Installs Node.js 18 and caches npm dependencies
3. **Install dependencies** - Runs `npm ci` to install packages
4. **Run daily feed update** - Executes `scripts/daily-update.js`
   - **Fetches FEEDS.md** from target repository to get list of playlist IDs
   - **Discovers playlists** in `docs/` matching FEEDS.md entries
   - **Extracts RSS feed URLs** from each playlist's XML
   - Checks all RSS feeds for new episodes
   - Generates playlists for feeds with new episodes
   - **Syncs updated playlists directly** to `chadf-musicl-playlists/docs/{playlistId}.xml` via GitHub API
5. **Commit and push changes** - Only commits `src/config/feeds.json` changes (if any) to the updater repository
   - **Note**: Playlist files are NOT committed to the updater repo - they're synced directly to the target repo

## Monitoring Workflow Runs

### View Workflow History

1. Go to your repository on GitHub
2. Click the "Actions" tab
3. Select "Daily RSS Feed Update" from the left sidebar
4. View run history and details

### Check Logs

1. Click on a workflow run
2. Expand the "Run daily feed update" step
3. View detailed logs for each feed check
4. Check for any errors or warnings

### Workflow Run Status

- **Green checkmark**: Workflow completed successfully
- **Red X**: Workflow failed (check logs)
- **Yellow circle**: Workflow in progress

## Troubleshooting

### Workflow Not Running

**Problem**: Workflow doesn't run on schedule

**Solutions**:
- Check that the workflow file exists in `.github/workflows/`
- Verify the cron syntax is correct
- Check GitHub Actions is enabled for your repository
- Note: Scheduled workflows can be delayed by up to 15 minutes

### GitHub Token Errors

**Problem**: `TOKEN` secret not found or invalid

**Solutions**:
- Verify the secret is named exactly `TOKEN` (not `GITHUB_TOKEN` - that name is reserved by GitHub)
- Ensure the token has `repo` permissions
- Regenerate the token if it was revoked
- Check that Actions are enabled for your repository

### No Updates Found

**Problem**: Workflow runs but no changes are committed or synced

**Possible reasons**:
- No new episodes in RSS feeds (check feed URLs manually)
- Episodes haven't changed since last check
- **Playlist discovery failed** - Check if token has read access to `chadf-musicl-playlists`
- **Sync to target repo failed** - Check if token has write access to `chadf-musicl-playlists`
- **No feeds found** - Add playlist IDs to `FEEDS.md` in the target repository or configure feeds in `src/config/feeds.json`
- This is normal behavior when feeds are up-to-date

**Note**: Check the logs for:
- "Found X playlist ID(s) in FEEDS.md" - Shows which feeds were parsed from FEEDS.md
- "Using X feed(s) from FEEDS.md" - Shows which feeds will be updated
- "FEEDS.md not found or empty, using X configured feed(s)" - Falls back to feeds.json
- "No new episodes in [feed name]" - Feed checked but no updates found
- Any errors during feed checks or sync

### Feed Check Failures

**Problem**: Specific RSS feeds fail to check

**Solutions**:
- Verify the RSS feed URL is accessible
- Check the feed URL in a browser
- Review logs for specific error messages
- Test the feed manually: `npm start check-feed <feed-id>`

### Playlist Generation Errors

**Problem**: Playlists aren't being generated or updated

**Solutions**:
- Check that `playlistId` matches expected format
- Verify playlist metadata is correct
- Review logs for XML generation errors
- Test locally: `node scripts/daily-update.js`

## Testing Locally

Before relying on GitHub Actions, you can test the update script locally:

```bash
# Set GitHub token as environment variable
export GITHUB_TOKEN=your_token_here

# Run the daily update script
node scripts/daily-update.js
```

This will:
- Check all configured RSS feeds (from `feeds.json` with `enabled: true`)
- Update playlists locally
- Sync updated playlists to `chadf-musicl-playlists/docs/` (if token is set)
- Show detailed logs

## Configuration Files

The workflow uses these configuration files:

- **`config.json`**: Main configuration (GitHub repo settings, logging)
- **`src/config/feeds.json`**: RSS feed configurations
- **`.github/workflows/daily-feed-update.yml`**: Workflow definition

## Environment Variables

The workflow automatically sets:
- `GITHUB_TOKEN`: Mapped from `TOKEN` repository secret (for API access)
  - Note: The secret is named `TOKEN` because `GITHUB_TOKEN` is reserved by GitHub Actions
  - This token needs **write access** to `chadf-musicl-playlists` repository for syncing playlists
  - This token needs **write access** to `musicL-playlist-updater` repository for committing config changes
- `NODE_ENV`: Production mode

The update script checks:
- `process.env.GITHUB_TOKEN`: First priority for GitHub token (set by workflow from `TOKEN` secret)
- `config.json`: Fallback for GitHub token

## How Playlists Are Synced

Playlists are synced to the target repository via GitHub API (not git commits):
1. Playlists are generated locally during workflow execution
2. Each updated playlist is uploaded directly to `chadf-musicl-playlists/docs/{playlistId}.xml` via GitHub API
3. Only `src/config/feeds.json` changes are committed to the updater repository
4. This means playlist files don't appear in the updater repo's commit history - they're only in the target repo

## Best Practices

1. **Monitor regularly**: Check workflow runs weekly to ensure everything is working
2. **Test manually first**: Trigger workflow manually before relying on schedule
3. **Keep dependencies updated**: Run `npm audit` and update packages regularly
4. **Review logs**: Check logs periodically to catch issues early
5. **Backup configs**: Keep backups of `config.json` and `feeds.json`
6. **Enable notifications**: Set up GitHub notifications for workflow failures

## Next Steps

After setup:
1. ✅ Verify `TOKEN` secret is configured (remember: not `GITHUB_TOKEN`)
2. ✅ Test workflow manually (Run workflow button)
3. ✅ Monitor first few scheduled runs
4. ✅ Verify playlists are being updated correctly
5. ✅ Check commit history for updates

## Support

If you encounter issues:
- Check the workflow logs in the Actions tab
- Review the error messages in `logs/` directory
- Verify all configuration files are correct
- Test the update script locally with `node scripts/daily-update.js`

For more information, see:
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Repository README](./README.md)
- [RSS to Playlist Setup](./RSS-TO-PLAYLIST-SETUP.md)


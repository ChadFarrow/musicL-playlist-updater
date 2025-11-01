# GitHub Actions Setup Guide

This guide explains how to set up and use the GitHub Actions workflow for automated daily RSS feed updates.

## Overview

The GitHub Actions workflow automatically:
1. Checks all configured RSS feeds for new episodes
2. Updates playlists with new tracks
3. Commits and pushes changes to your repository

The workflow runs **once per day at midnight UTC** and can also be triggered manually.

## Prerequisites

- A GitHub repository with the playlist updater code
- Node.js 18+ compatible codebase
- RSS feeds configured in `src/config/feeds.json`

## Setup Instructions

### Step 1: Add GitHub Token Secret

You need to create a Personal Access Token (PAT) with repository write permissions.

1. **Create a Personal Access Token:**
   - Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Click "Generate new token (classic)"
   - Give it a descriptive name (e.g., "Playlist Updater")
   - Select the `repo` scope (full control of private repositories)
   - Click "Generate token"
   - **Copy the token immediately** (you won't be able to see it again)

2. **Add the token as a repository secret:**
   - Go to your repository: `https://github.com/ChadFarrow/chadf-musicl-playlists`
   - Navigate to: Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `TOKEN` (Note: `GITHUB_TOKEN` is reserved by GitHub, so use `TOKEN` instead)
   - Value: Paste your Personal Access Token
   - Click "Add secret"

### Step 2: Verify Configuration

Ensure your `src/config/feeds.json` has RSS feeds configured with:
- `enabled: true` for feeds you want to monitor
- Valid `rssUrl` for each feed
- Proper `playlistId` and metadata

Example:
```json
{
  "rssFeeds": [
    {
      "id": "homegrown-hits-feed",
      "name": "Homegrown Hits Podcast",
      "rssUrl": "https://feed.homegrownhits.xyz/feed.xml",
      "playlistId": "HGH-music-playlist",
      "enabled": true,
      ...
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

1. **Checkout repository** - Gets the latest code
2. **Setup Node.js** - Installs Node.js 18 and caches npm dependencies
3. **Install dependencies** - Runs `npm ci` to install packages
4. **Run daily feed update** - Executes `scripts/daily-update.js`
   - Checks all enabled RSS feeds
   - Generates playlists for feeds with new episodes
   - Syncs updated playlists to GitHub
5. **Commit and push changes** - If any playlists were updated, commits and pushes them to the repository

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

**Problem**: Workflow runs but no changes are committed

**Possible reasons**:
- No new episodes in RSS feeds (check feed URLs manually)
- Feeds are disabled in `src/config/feeds.json`
- Episodes haven't changed since last check
- This is normal behavior when feeds are up-to-date

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
- Check all enabled RSS feeds
- Update playlists locally
- Sync to GitHub (if token is set)
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
- `NODE_ENV`: Production mode

The update script checks:
- `process.env.GITHUB_TOKEN`: First priority for GitHub token (set by workflow from `TOKEN` secret)
- `config.json`: Fallback for GitHub token

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


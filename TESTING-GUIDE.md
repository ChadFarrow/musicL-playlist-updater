# Testing Guide

This guide explains how to test the playlist updater to ensure feeds won't be broken before running the actual GitHub Actions workflow.

## Quick Test

Run the comprehensive format preservation test for all playlists:

```bash
GITHUB_TOKEN=your_token_here node scripts/test-update.js
```

This will:
- ✅ Discover all playlists from the target repository
- ✅ Detect each playlist's existing format (full-items vs remoteItem-only)
- ✅ Generate test playlists preserving the format
- ✅ Verify format preservation for all feeds

**Expected output**: All tests should pass, confirming format preservation works.

## Single Playlist Dry-Run

Test updating a single playlist without committing changes:

```bash
GITHUB_TOKEN=your_token_here node scripts/test-single-update.js HGH-music-playlist
```

This will:
- 💾 Fetch the existing playlist from GitHub
- ⏳ Fetch the RSS feed and generate an updated playlist
- 💾 Save comparison files:
  - `test-playlists/HGH-music-playlist-BEFORE.xml` (existing)
  - `test-playlists/HGH-music-playlist-AFTER.xml` (generated)
- ✅ Verify format preservation
- 🚫 **No files are updated in GitHub** (dry-run only)

**Review the generated file** to verify:
- Format matches the original
- Episodes are correctly generated
- All metadata is preserved

## What Gets Tested

### Format Preservation
- ✅ Detects existing playlist format (full-items or remoteItem-only)
- ✅ Generates new playlist in the same format
- ✅ Preserves all metadata (descriptions, enclosures, value tags for full-items format)

### RSS Feed Processing
- ✅ Fetches RSS feed successfully
- ✅ Parses episodes correctly
- ✅ Generates proper `podcast:remoteItem` entries or full `<item>` entries

### Content Validation
- ✅ Verifies episode count
- ✅ Confirms latest episode is included
- ✅ Checks that all required tags are present

## Before Running the Workflow

1. **Run format preservation test**:
   ```bash
   GITHUB_TOKEN=your_token node scripts/test-update.js
   ```
   
   ✅ If all tests pass, proceed.

2. **Optional: Test a single playlist update**:
   ```bash
   GITHUB_TOKEN=your_token node scripts/test-single-update.js HGH-music-playlist
   ```
   
   📁 Review the generated file in `test-playlists/` to verify it looks correct.

3. **Run the GitHub Actions workflow**:
   - Go to your repository's Actions tab
   - Click "Run workflow" on the `daily-feed-update` workflow
   - Or wait for the scheduled daily run

## Troubleshooting

### Tests Fail with "Format mismatch"
- Check that `RSSPlaylistGenerator.generatePlaylistFromRSS` is detecting the existing format correctly
- Verify the existing playlist in GitHub has a valid format

### Tests Fail with "No RSS feed found"
- Ensure the playlist XML contains a `<podcast:txt purpose="source-feed">` tag
- Or configure the RSS feed in `src/config/feeds.json`

### Tests Fail with "Playlist not found"
- Verify the playlist ID is correct (without `.xml` extension)
- Check that the playlist exists in `docs/` directory of the target repository

## Test Output Examples

### Successful Test
```
🧪 Testing format preservation for: HGH-music-playlist
  📋 Existing format detected: remoteItem-only
  📊 Existing: 0 items, 841 remoteItems
  🔗 RSS Feed: https://feed.homegrownhits.xyz/feed.xml
  ✨ Generated format: remoteItem-only
  📊 Generated: 0 items, 109 remoteItems
  ✅ Format preserved correctly!
  ✅ Test passed for HGH-music-playlist
```

### Failed Test
```
🧪 Testing format preservation for: HGH-music-playlist
  📋 Existing format detected: full-items
  ✨ Generated format: remoteItem-only
  ❌ Format mismatch! Existing: full-items, Generated: remoteItem-only
  ❌ Test failed for HGH-music-playlist
```

## Safety Features

- ✅ **No commits during testing** - All tests are read-only
- ✅ **Format detection** - Automatically preserves existing playlist format
- ✅ **Dry-run mode** - Single playlist updates can be tested without committing
- ✅ **Comparison files** - Before/after files saved locally for review

## Next Steps

After confirming tests pass:
1. ✅ Push changes to your repository
2. ✅ The GitHub Actions workflow will run automatically
3. ✅ Monitor the workflow run to ensure it completes successfully
4. ✅ Verify updated playlists in the target repository


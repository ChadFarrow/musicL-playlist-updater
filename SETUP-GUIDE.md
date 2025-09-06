# Setup Guide for chadf-musicl-playlists Integration

This guide will help you set up the MusicL Playlist Updater to automatically monitor RSS feeds and update playlists in your [chadf-musicl-playlists repository](https://github.com/ChadFarrow/chadf-musicl-playlists/tree/main/docs).

## 🚀 Quick Setup

### 1. Configure GitHub Integration

Edit `config.json` and add your GitHub token:

```json
{
  "github": {
    "token": "ghp_your_github_token_here",
    "repoOwner": "ChadFarrow",
    "repoName": "chadf-musicl-playlists",
    "repoBranch": "main",
    "enableSync": true
  }
}
```

**To get a GitHub token:**
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate new token (classic)
3. Select `repo` scope for full repository access
4. Copy the token and paste it in `config.json`

### 2. Add Your First Feed

```bash
# Add a feed with a real RSS URL
npm start add-feed "Your Podcast Name" "https://your-podcast.com/feed.xml"
```

### 3. Start Monitoring

```bash
# Start the automatic updater
npm start start
```

## 📁 Repository Structure

The system will automatically sync playlists to your repository:

```
chadf-musicl-playlists/
├── docs/
│   ├── your-playlist-1.xml    ← Auto-generated playlists
│   ├── your-playlist-2.xml    ← Auto-generated playlists
│   └── ...
└── ...
```

## 🔄 How It Works

1. **Monitors RSS feeds** every 30 minutes (configurable)
2. **Detects new episodes** by comparing GUIDs
3. **Generates musicL XML** playlists with Podcasting 2.0 features
4. **Commits to GitHub** automatically in the `docs/` directory
5. **Logs all activity** for monitoring and debugging

## 🎵 Example Feed Configuration

```javascript
{
  "name": "My Music Podcast",
  "rssUrl": "https://example.com/feed.xml",
  "playlistId": "my-music-podcast",
  "playlistTitle": "My Music Podcast Playlist",
  "playlistDescription": "Auto-updated playlist from My Music Podcast",
  "playlistAuthor": "ChadFarrow",
  "enabled": true,
  "checkIntervalMinutes": 30
}
```

## 🛠️ Available Commands

```bash
# Start monitoring
npm start start

# Add a new feed
npm start add-feed "Podcast Name" "https://feed-url.com/feed.xml"

# Check a specific feed manually
npm start check-feed feed-id

# View status
npm start status

# List all feeds
npm start list-feeds

# Remove a feed
npm start remove-feed feed-id
```

## 📊 Monitoring

- **Logs**: Check `logs/combined.log` for all activity
- **Errors**: Check `logs/error.log` for issues
- **Status**: Run `npm start status` to see current state

## 🔧 Configuration Options

Edit `config.json` to customize:

- **Check intervals**: How often to check feeds
- **GitHub sync**: Enable/disable automatic commits
- **Logging level**: Control verbosity
- **Storage paths**: Where to store local files

## 🚨 Troubleshooting

### GitHub Sync Issues
- Verify your GitHub token has `repo` permissions
- Check that the repository name is correct
- Ensure the branch exists

### RSS Feed Issues
- Test the RSS URL in a browser first
- Check if the feed has valid XML
- Verify the feed is publicly accessible

### No Updates Detected
- Check if the feed actually has new episodes
- Verify the feed URL is correct
- Look at logs for error messages

## 🎯 Integration Benefits

✅ **Fully Automated**: No manual playlist updates needed  
✅ **GitHub Pages Ready**: Files go directly to `docs/` directory  
✅ **Podcasting 2.0**: Supports all modern podcast features  
✅ **Multiple Feeds**: Monitor as many feeds as you want  
✅ **Reliable**: Comprehensive error handling and logging  

## 📝 Next Steps

1. **Add your feeds**: Use the CLI to add RSS feeds you want to monitor
2. **Test the system**: Run a manual check to verify everything works
3. **Start monitoring**: Let it run automatically
4. **Check your repository**: See the updated playlists in your `docs/` folder

Your playlists will be automatically updated and available at:
`https://chadfarrow.github.io/chadf-musicl-playlists/`

# 🎵 RSS Feed to Playlist Generator - Complete Setup

## ✅ **System Successfully Configured**

Your automated RSS feed monitoring system is now ready to monitor the [Homegrown Hits RSS feed](https://feed.homegrownhits.xyz/feed.xml) and automatically update your `HGH-music-playlist.xml` on GitHub when new episodes are released.

## 🔄 **How It Works**

1. **Monitors RSS Feed**: Checks [https://feed.homegrownhits.xyz/feed.xml](https://feed.homegrownhits.xyz/feed.xml) every 30 minutes
2. **Detects New Episodes**: Compares latest episode GUID with stored value
3. **Generates musicL Playlist**: Creates compliant XML playlist from RSS episodes
4. **Syncs to GitHub**: Automatically commits updated playlist to your repository
5. **Logs Activity**: Records all updates and changes

## 📊 **Current Configuration**

- **Monitor Mode**: `rss-to-playlist`
- **RSS Feed**: Homegrown Hits Podcast
- **Target Playlist**: `HGH-music-playlist.xml`
- **Check Interval**: 30 minutes
- **Episodes Found**: 102 episodes
- **Latest Episode**: "Homegrown Hits - Episode 101"

## 🚀 **Ready to Start**

### **1. Start Monitoring**
```bash
npm start start
```

### **2. Check Status**
```bash
npm start status
```

### **3. Test RSS Feed Generation**
```bash
# Test the Homegrown Hits feed
node -e "
import('./src/services/RSSPlaylistGenerator.js').then(async (module) => {
  const generator = new module.RSSPlaylistGenerator({
    playlistsDir: './playlists',
    enableGitHubSync: false
  });
  
  const feedConfig = {
    name: 'Homegrown Hits Podcast',
    rssUrl: 'https://feed.homegrownhits.xyz/feed.xml',
    playlistId: 'HGH-music-playlist',
    playlistTitle: 'ChadF Homegrown Hits Music Playlist',
    playlistDescription: 'Curated playlist from Homegrown Hits podcast',
    playlistAuthor: 'ChadFarrow'
  };
  
  const result = await generator.generatePlaylistFromRSS(feedConfig);
  console.log('Episodes:', result.episodeCount);
  console.log('Latest:', result.lastEpisode);
});
"
```

## 📁 **Generated Files**

- **Local Playlist**: `playlists/HGH-music-playlist.xml`
- **GitHub Target**: `docs/HGH-music-playlist.xml` (when GitHub sync enabled)
- **Logs**: `logs/combined.log` and `logs/error.log`

## ⚙️ **Configuration Details**

The system is configured in `src/config/feeds.json`:

```json
{
  "rssFeeds": [
    {
      "id": "homegrown-hits-feed",
      "name": "Homegrown Hits Podcast",
      "rssUrl": "https://feed.homegrownhits.xyz/feed.xml",
      "playlistId": "HGH-music-playlist",
      "playlistTitle": "ChadF Homegrown Hits Music Playlist",
      "playlistDescription": "Curated playlist from Homegrown Hits podcast featuring Value4Value independent artists",
      "playlistAuthor": "ChadFarrow",
      "playlistImageUrl": "https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/HGH-playlist-art.webp",
      "enabled": true,
      "checkIntervalMinutes": 30
    }
  ]
}
```

## 🔗 **GitHub Integration**

To enable automatic syncing to your GitHub repository:

1. **Add GitHub Token** to `config.json`:
   ```json
   {
     "github": {
       "token": "ghp_your_github_token_here",
       "enableSync": true
     }
   }
   ```

2. **The system will automatically**:
   - Commit updated playlists to `docs/HGH-music-playlist.xml`
   - Use descriptive commit messages
   - Handle file creation and updates seamlessly

## 📋 **Available Commands**

```bash
npm start start          # Start RSS feed monitoring
npm start status         # Show current status
npm start discover       # Re-scan for new playlists
npm start list-feeds     # List all configured feeds
```

## 🎯 **What Happens When New Episodes Are Released**

1. **Detection**: System detects new episode in RSS feed
2. **Generation**: Creates updated musicL playlist with all episodes
3. **Local Save**: Saves playlist to `playlists/HGH-music-playlist.xml`
4. **GitHub Sync**: Commits updated playlist to your repository
5. **Logging**: Records the update with episode count and details

## 🎉 **Ready to Go!**

Your system is now monitoring the Homegrown Hits RSS feed and will automatically update your playlist whenever new episodes are released. The generated playlist includes all 102 episodes with proper musicL formatting, Podcasting 2.0 features, and value tags.

**Start monitoring now:**
```bash
npm start start
```

Your playlist will be automatically updated and available at:
`https://chadfarrow.github.io/chadf-musicl-playlists/HGH-music-playlist.xml`

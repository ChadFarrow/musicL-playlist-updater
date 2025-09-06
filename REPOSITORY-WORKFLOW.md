# 🏗️ Repository Workflow - Safe Development & Deployment

## 🎯 **Your Workflow Strategy**

You want to use your [chadf-musicl-playlists repository](https://github.com/ChadFarrow/chadf-musicl-playlists) to host the playlists, but develop and test everything locally first before pushing any changes to the repository.

## 🛡️ **Safe Development Approach**

### **Phase 1: Local Development & Testing**
- ✅ Develop and test locally
- ✅ Generate playlists in local directories
- ✅ Verify everything works correctly
- ✅ GitHub sync DISABLED (no accidental commits)

### **Phase 2: Ready for Production**
- ✅ Add your GitHub token
- ✅ Enable GitHub sync
- ✅ Deploy to your repository
- ✅ Monitor live updates

## 🚀 **Development Commands**

### **1. Test with Repository Structure (Safe)**
```bash
node test-without-github.js
```
This sets up:
- Production directory structure (`playlists/`, `data/`, `logs/`)
- Production playlist names (`HGH-music-playlist.xml`)
- GitHub sync DISABLED (safe)
- Faster testing (5-minute intervals)

### **2. Test RSS Feed Generation**
```bash
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
    playlistDescription: 'Curated playlist from Homegrown Hits podcast featuring Value4Value independent artists',
    playlistAuthor: 'ChadFarrow',
    playlistImageUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/HGH-playlist-art.webp'
  };
  
  const result = await generator.generatePlaylistFromRSS(feedConfig);
  console.log('Episodes:', result.episodeCount);
  console.log('Latest:', result.lastEpisode);
});
"
```

### **3. Test Full System**
```bash
npm start start
# (Ctrl+C to stop)
```

### **4. Check Generated Files**
```bash
ls playlists/
cat playlists/HGH-music-playlist.xml
```

## 📁 **Directory Structure**

```
musicL playlist updater/
├── playlists/                    # Production playlist files
│   └── HGH-music-playlist.xml   # Generated playlist
├── data/                         # Data storage
├── logs/                         # Log files
├── config.json                   # Current config
├── src/config/feeds.json         # Current feeds
├── config-backup.json           # Backup of previous config
└── src/config/feeds-backup.json # Backup of previous feeds
```

## 🔧 **Configuration States**

### **Development Mode (Current)**
```json
{
  "github": {
    "enableSync": false
  },
  "monitoring": {
    "checkIntervalMinutes": 5
  },
  "logging": {
    "level": "debug"
  }
}
```

### **Production Mode (When Ready)**
```json
{
  "github": {
    "token": "your_github_token_here",
    "enableSync": true
  },
  "monitoring": {
    "checkIntervalMinutes": 30
  },
  "logging": {
    "level": "info"
  }
}
```

## 🎯 **Development Workflow**

### **Step 1: Setup Development Environment**
```bash
node test-without-github.js
```

### **Step 2: Develop & Test**
- Make changes to source code
- Test RSS feed generation
- Verify playlist output
- Check file operations

### **Step 3: Iterate**
- Fix issues
- Test again
- Repeat until satisfied

### **Step 4: Prepare for Production**
```bash
node setup-production.js
# Then edit config.json to add your GitHub token
```

### **Step 5: Deploy to Repository**
```bash
npm start start
```

## 🛡️ **Safety Features**

### **✅ What's Protected:**
- **GitHub repository** - No changes until you're ready
- **Original configs** - Automatically backed up
- **Local testing** - All operations are local
- **Easy rollback** - Simple restore process

### **✅ What You Can Safely Test:**
- RSS feed parsing (102 episodes from Homegrown Hits)
- Playlist generation (musicL-compliant XML)
- File operations (local directories)
- Configuration changes
- New features and modifications

## 📊 **Current Test Results**

### **✅ Verified Working:**
- RSS feed parsing: ✅ 102 episodes
- Playlist generation: ✅ musicL-compliant XML
- File operations: ✅ `playlists/HGH-music-playlist.xml`
- Configuration: ✅ Production structure
- Safety: ✅ GitHub sync disabled

### **✅ Ready for Production:**
- Directory structure matches your repository
- Playlist names match your repository
- Configuration ready for GitHub token
- All safety measures in place

## 🚀 **When You're Ready for Production**

### **1. Add GitHub Token**
Edit `config.json`:
```json
{
  "github": {
    "token": "ghp_your_actual_token_here",
    "enableSync": true
  }
}
```

### **2. Start Production Monitoring**
```bash
npm start start
```

### **3. Monitor Updates**
```bash
npm start status
tail -f logs/combined.log
```

## 🎉 **Ready for Safe Development!**

Your development environment is now set up to:
- ✅ Use your repository structure
- ✅ Generate playlists with correct names
- ✅ Test everything locally
- ✅ Keep your GitHub repository safe
- ✅ Deploy when you're ready

**Start developing:**
```bash
node test-without-github.js
# Make your changes
# Test safely
# Deploy when ready
```

The system is ready for safe development with your repository structure!

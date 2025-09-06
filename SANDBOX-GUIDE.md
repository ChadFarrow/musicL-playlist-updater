# 🧪 Test Sandbox Environment

## 🛡️ **Safe Testing Environment**

This sandbox allows you to safely test and develop the RSS feed monitoring system without affecting your live playlists or GitHub repository.

## 🚀 **Quick Start**

### **1. Setup Test Environment**
```bash
npm run sandbox:setup
```
This will:
- ✅ Backup your original configurations
- ✅ Create test directories (`test-playlists/`, `test-data/`, `test-logs/`)
- ✅ Switch to test configurations
- ✅ Disable GitHub sync for safety

### **2. Run Tests**
```bash
npm run sandbox:test
```

### **3. Check Status**
```bash
npm run sandbox:status
```

### **4. Restore Original Config**
```bash
npm run sandbox:restore
```

## 📁 **Test Environment Structure**

```
musicL playlist updater/
├── test-playlists/          # Test playlist files
├── test-data/              # Test data storage
├── test-logs/              # Test logs
├── config-test.json        # Test configuration
├── src/config/feeds-test.json  # Test feed configurations
├── config-backup.json      # Backup of original config
└── src/config/feeds-backup.json  # Backup of original feeds
```

## ⚙️ **Test Configuration**

### **Test Settings:**
- **GitHub Sync**: DISABLED (safe testing)
- **Check Interval**: 5 minutes (faster testing)
- **Log Level**: debug (detailed logging)
- **Test Playlist**: `HGH-music-playlist-TEST`
- **Test Branch**: `test-branch` (if GitHub sync enabled)

### **Test Feed Configuration:**
```json
{
  "id": "homegrown-hits-feed-test",
  "name": "Homegrown Hits Podcast (TEST)",
  "rssUrl": "https://feed.homegrownhits.xyz/feed.xml",
  "playlistId": "HGH-music-playlist-TEST",
  "playlistTitle": "TEST - ChadF Homegrown Hits Music Playlist",
  "playlistDescription": "TEST - Curated playlist from Homegrown Hits podcast",
  "playlistAuthor": "ChadFarrow-TEST",
  "enabled": true,
  "checkIntervalMinutes": 5
}
```

## 🧪 **Testing Workflow**

### **1. Development Testing**
```bash
# Setup sandbox
npm run sandbox:setup

# Test RSS feed generation
npm run sandbox:test

# Check what was generated
ls test-playlists/

# View test logs
tail -f test-logs/combined.log
```

### **2. Manual Testing**
```bash
# Test specific functionality
node -e "
import('./src/services/RSSPlaylistGenerator.js').then(async (module) => {
  const generator = new module.RSSPlaylistGenerator({
    playlistsDir: './test-playlists',
    enableGitHubSync: false
  });
  
  const feedConfig = {
    name: 'Homegrown Hits Podcast (TEST)',
    rssUrl: 'https://feed.homegrownhits.xyz/feed.xml',
    playlistId: 'HGH-music-playlist-TEST',
    playlistTitle: 'TEST - ChadF Homegrown Hits Music Playlist',
    playlistDescription: 'TEST - Curated playlist from Homegrown Hits podcast',
    playlistAuthor: 'ChadFarrow-TEST'
  };
  
  const result = await generator.generatePlaylistFromRSS(feedConfig);
  console.log('Test Result:', result.success);
  console.log('Episodes:', result.episodeCount);
});
"
```

### **3. Integration Testing**
```bash
# Test the full system
npm start start

# Check status
npm start status

# Stop when done
# (Ctrl+C)
```

## 🔒 **Safety Features**

### **✅ What's Protected:**
- **Original configurations** are backed up
- **GitHub sync is disabled** by default
- **Test playlists** use different names (`-TEST` suffix)
- **Test directories** are separate from production
- **Test branch** prevents accidental commits to main

### **✅ What's Safe to Test:**
- RSS feed parsing
- Playlist generation
- File operations
- Logging and monitoring
- Configuration changes
- New features and modifications

## 📋 **Available Commands**

```bash
# Sandbox management
npm run sandbox:setup      # Setup test environment
npm run sandbox:test       # Run tests
npm run sandbox:status     # Show sandbox status
npm run sandbox:restore    # Restore original configs

# Manual testing
node test-sandbox.js setup
node test-sandbox.js test
node test-sandbox.js restore
node test-sandbox.js status
```

## 🎯 **Development Workflow**

### **1. Start Development**
```bash
npm run sandbox:setup
```

### **2. Make Changes**
- Edit source files
- Modify configurations
- Add new features

### **3. Test Changes**
```bash
npm run sandbox:test
```

### **4. Iterate**
- Fix issues
- Test again
- Repeat until satisfied

### **5. Deploy to Production**
```bash
npm run sandbox:restore
# Now run production system
npm start start
```

## 🚨 **Important Notes**

- **Always restore** original configs before running production
- **Test playlists** are safe to modify/delete
- **GitHub sync** is disabled in test mode
- **Backup files** are created automatically
- **Test directories** can be safely deleted

## 🎉 **Ready for Safe Testing!**

The sandbox environment is now ready for safe development and testing. You can experiment freely without worrying about affecting your live playlists or GitHub repository.

**Start testing:**
```bash
npm run sandbox:setup
npm run sandbox:test
```

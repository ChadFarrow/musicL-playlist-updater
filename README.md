# MusicL Playlist Updater

An automated RSS feed monitor and musicL playlist updater that watches RSS feeds for new episodes and automatically updates your musicL playlists.

## Features

- 🔄 **Automatic RSS Monitoring**: Continuously monitors RSS feeds for new episodes
- 📝 **Playlist Generation**: Creates musicL-compliant XML playlists from RSS feeds
- ⏰ **Flexible Scheduling**: Configurable check intervals per feed
- 🔗 **GitHub Integration**: Automatically syncs updated playlists to your GitHub repository
- 📊 **Comprehensive Logging**: Detailed logging with Winston
- 🎵 **Podcasting 2.0 Support**: Handles `podcast:remoteItem` and value tags
- 🛠️ **CLI Interface**: Easy command-line management

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp env.example .env
   # Edit .env with your settings
   ```

3. **Add your first feed**:
   ```bash
   npm start add-feed "My Podcast" "https://example.com/feed.xml"
   ```

4. **Start monitoring**:
   ```bash
   npm start start
   ```

## Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# RSS Feed Monitor Configuration
CHECK_INTERVAL_MINUTES=30
MAX_RETRIES=3
RETRY_DELAY_MS=5000

# GitHub Integration (for auto-committing updates)
GITHUB_TOKEN=your_github_token_here
GITHUB_REPO_OWNER=ChadFarrow
GITHUB_REPO_NAME=chadf-musicl-playlists
GITHUB_REPO_BRANCH=main

# Notification Settings
WEBHOOK_URL=your_webhook_url_here
EMAIL_NOTIFICATIONS=false
LOG_LEVEL=info

# Storage
DATA_DIR=./data
PLAYLISTS_DIR=./playlists
```

### Feed Configuration

Feeds are configured in `src/config/feeds.json`. Each feed can have:

- `id`: Unique identifier
- `name`: Display name
- `rssUrl`: RSS feed URL
- `playlistId`: Unique playlist identifier
- `playlistTitle`: Playlist title
- `playlistDescription`: Playlist description
- `playlistAuthor`: Playlist author
- `playlistImageUrl`: Playlist image URL
- `enabled`: Whether the feed is active
- `checkIntervalMinutes`: How often to check (default: 30)

## Usage

### CLI Commands

```bash
# Start the automatic updater
npm start start

# Add a new RSS feed
npm start add-feed "Podcast Name" "https://example.com/feed.xml"

# Remove a feed
npm start remove-feed feed-id

# Manually check a specific feed
npm start check-feed feed-id

# Show current status
npm start status

# List all configured feeds
npm start list-feeds
```

### Programmatic Usage

```javascript
import { MusicLPlaylistUpdater } from './src/index.js';

const updater = new MusicLPlaylistUpdater();

// Add a feed
await updater.addFeed({
  name: "My Podcast",
  rssUrl: "https://example.com/feed.xml",
  playlistId: "my-podcast",
  playlistTitle: "My Podcast Playlist",
  playlistDescription: "Auto-updated playlist",
  playlistAuthor: "Your Name"
});

// Start monitoring
await updater.start();
```

## How It Works

1. **RSS Monitoring**: The system periodically checks configured RSS feeds for new episodes
2. **Change Detection**: Compares the latest episode GUID with the previously stored one
3. **Playlist Generation**: When new episodes are found, generates a musicL-compliant XML playlist
4. **GitHub Sync**: Automatically commits updated playlists to your GitHub repository
5. **Logging**: Records all activities with detailed logs

## Generated Playlist Format

The system generates musicL-compliant XML playlists that include:

- Standard RSS 2.0 structure
- `podcast:medium` set to `musicL`
- `podcast:remoteItem` entries for Podcasting 2.0 compatibility
- Value tags for Lightning Network payments
- Proper CDATA sections for content

## GitHub Integration

When enabled, the system will:

1. Automatically commit updated playlists to your repository
2. Place files in the `docs/` directory (compatible with GitHub Pages)
3. Use descriptive commit messages
4. Handle file creation and updates seamlessly

## Logging

Logs are written to:
- Console (with colors)
- `logs/combined.log` (all logs)
- `logs/error.log` (errors only)

Log levels: `error`, `warn`, `info`, `debug`

## Development

### Project Structure

```
src/
├── services/
│   ├── RSSMonitor.js      # RSS feed monitoring
│   ├── PlaylistUpdater.js # Playlist generation
│   ├── GitHubSync.js      # GitHub integration
│   └── Scheduler.js       # Task scheduling
├── utils/
│   └── logger.js          # Logging configuration
├── config/
│   └── feeds.json         # Feed configuration
└── index.js               # Main application
```

### Running in Development

```bash
# Watch mode for development
npm run dev

# Run tests
npm test
```

## Integration with Auto-musicL-Maker

This tool complements your [Auto-musicL-Maker](https://github.com/ChadFarrow/Auto-musicL-Maker) by providing:

- **Automation**: No need to manually create playlists
- **Continuous Updates**: Automatically updates when new episodes are released
- **Batch Processing**: Can monitor multiple feeds simultaneously
- **GitHub Sync**: Seamlessly integrates with your existing repository structure

## Troubleshooting

### Common Issues

1. **RSS Feed Not Loading**: Check the URL and ensure it's accessible
2. **GitHub Sync Failing**: Verify your GitHub token has repository write permissions
3. **No New Episodes Detected**: Check if the feed actually has new content

### Debug Mode

Enable debug logging:
```env
LOG_LEVEL=debug
```

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions:
- Check the logs in `logs/` directory
- Review the configuration in `src/config/feeds.json`
- Ensure all environment variables are set correctly

import axios from 'axios';
import { logger } from '../utils/logger.js';

export class PlaylistDiscovery {
  constructor(config) {
    this.config = config;
    this.githubApiUrl = `https://api.github.com/repos/${config.githubRepoOwner}/${config.githubRepoName}/contents/docs`;
    this.githubRawUrl = `https://raw.githubusercontent.com/${config.githubRepoOwner}/${config.githubRepoName}/${config.githubRepoBranch}/docs`;
  }

  async discoverPlaylists() {
    try {
      logger.info('Discovering playlists in docs folder...');
      
      const response = await axios.get(this.githubApiUrl, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'musicl-playlist-updater'
        }
      });

      const files = response.data;
      const xmlFiles = files.filter(file => 
        file.name.endsWith('.xml') && 
        file.type === 'file'
      );

      logger.info(`Found ${xmlFiles.length} XML playlist files`);

      const playlists = [];
      for (const file of xmlFiles) {
        try {
          const playlistInfo = await this.analyzePlaylistFile(file);
          if (playlistInfo) {
            playlists.push(playlistInfo);
          }
        } catch (error) {
          logger.error(`Error analyzing ${file.name}:`, error);
        }
      }

      return playlists;
    } catch (error) {
      logger.error('Error discovering playlists:', error);
      throw error;
    }
  }

  async analyzePlaylistFile(file) {
    try {
      const rawUrl = `${this.githubRawUrl}/${file.name}`;
      logger.info(`Analyzing playlist: ${file.name}`);

      const response = await axios.get(rawUrl, {
        headers: {
          'Accept': 'application/xml, text/xml, */*',
          'User-Agent': 'musicl-playlist-updater'
        },
        timeout: 10000
      });

      const content = response.data;
      const playlistInfo = this.parsePlaylistContent(content, file);

      if (playlistInfo) {
        logger.info(`Parsed playlist: ${playlistInfo.title} (${playlistInfo.itemCount} items)`);
        return {
          id: playlistInfo.id,
          name: playlistInfo.title,
          playlistId: playlistInfo.id,
          playlistTitle: playlistInfo.title,
          playlistDescription: playlistInfo.description,
          playlistAuthor: playlistInfo.author,
          playlistImageUrl: playlistInfo.imageUrl,
          githubUrl: rawUrl,
          fileName: file.name,
          enabled: true,
          lastChecked: null,
          lastModified: file.updated_at,
          checkIntervalMinutes: 30,
          itemCount: playlistInfo.itemCount,
          pubDate: playlistInfo.pubDate,
          lastBuildDate: playlistInfo.lastBuildDate
        };
      }

      return null;
    } catch (error) {
      logger.error(`Error analyzing playlist file ${file.name}:`, error);
      return null;
    }
  }

  parsePlaylistContent(content, file) {
    try {
      // Extract title
      const titleMatch = content.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/);
      const title = titleMatch ? titleMatch[1] : file.name.replace('.xml', '');

      // Extract description
      const descriptionMatch = content.match(/<description><!\[CDATA\[([^\]]+)\]\]><\/description>/);
      const description = descriptionMatch ? descriptionMatch[1] : `Auto-discovered playlist: ${title}`;

      // Extract author
      const authorMatch = content.match(/<managingEditor>([^<]+)<\/managingEditor>/);
      const author = authorMatch ? authorMatch[1] : 'ChadFarrow';

      // Extract image URL
      const imageMatch = content.match(/<url>([^<]+)<\/url>/);
      const imageUrl = imageMatch ? imageMatch[1] : '';

      // Extract pubDate
      const pubDateMatch = content.match(/<pubDate>([^<]+)<\/pubDate>/);
      const pubDate = pubDateMatch ? pubDateMatch[1] : '';

      // Extract lastBuildDate
      const lastBuildDateMatch = content.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/);
      const lastBuildDate = lastBuildDateMatch ? lastBuildDateMatch[1] : '';

      // Count items
      const itemMatches = content.match(/<item>/g);
      const itemCount = itemMatches ? itemMatches.length : 0;

      // Generate ID from filename
      const id = file.name.replace('.xml', '').toLowerCase().replace(/[^a-z0-9-]/g, '-');

      return {
        id,
        title,
        description,
        author,
        imageUrl,
        pubDate,
        lastBuildDate,
        itemCount
      };
    } catch (error) {
      logger.error('Error parsing playlist content:', error);
      return null;
    }
  }

  async updatePlaylistConfig(discoveredPlaylists) {
    try {
      const fs = require('fs');
      const path = require('path');
      const configPath = path.join(process.cwd(), 'src', 'config', 'feeds.json');
      
      // Read existing config
      let configData;
      try {
        configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (error) {
        configData = { playlists: [], settings: {} };
      }

      // Update playlists array
      configData.playlists = discoveredPlaylists;
      configData.settings = {
        ...configData.settings,
        defaultCheckInterval: 30,
        maxRetries: 3,
        retryDelayMs: 5000,
        enableGitHubSync: true,
        enableNotifications: true,
        monitorMode: 'playlist',
        lastDiscovery: new Date().toISOString()
      };

      // Write updated config
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
      
      logger.info(`Updated playlist config with ${discoveredPlaylists.length} playlists`);
      return configData;
    } catch (error) {
      logger.error('Error updating playlist config:', error);
      throw error;
    }
  }
}

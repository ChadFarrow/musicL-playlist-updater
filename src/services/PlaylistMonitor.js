import axios from 'axios';
import { logger } from '../utils/logger.js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export class PlaylistMonitor {
  constructor(config) {
    this.config = config;
    this.githubBaseUrl = `https://raw.githubusercontent.com/${config.githubRepoOwner}/${config.githubRepoName}/${config.githubRepoBranch}/docs`;
    this.localPlaylistsDir = config.playlistsDir || './playlists';
  }

  async getPlaylistFromGitHub(playlistId) {
    try {
      const url = `${this.githubBaseUrl}/${playlistId}.xml`;
      logger.info(`Fetching playlist from GitHub: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/xml, text/xml, */*',
          'User-Agent': 'musicl-playlist-updater'
        },
        timeout: 10000
      });

      return {
        content: response.data,
        lastModified: response.headers['last-modified'],
        etag: response.headers['etag']
      };
    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn(`Playlist not found on GitHub: ${playlistId}`);
        return null;
      }
      logger.error(`Error fetching playlist ${playlistId}:`, error);
      throw error;
    }
  }

  async checkPlaylistForUpdates(playlistConfig) {
    try {
      logger.info(`Checking playlist: ${playlistConfig.name}`);
      
      const githubData = await this.getPlaylistFromGitHub(playlistConfig.playlistId);
      
      if (!githubData) {
        logger.warn(`Playlist ${playlistConfig.playlistId} not found on GitHub`);
        return { hasUpdates: false, playlistData: null };
      }

      // Check if we have a local copy to compare
      const localPath = join(this.localPlaylistsDir, `${playlistConfig.playlistId}.xml`);
      let localContent = null;
      
      try {
        localContent = readFileSync(localPath, 'utf8');
      } catch (error) {
        // Local file doesn't exist, this is a new playlist
        logger.info(`New playlist detected: ${playlistConfig.playlistId}`);
      }

      // Compare content to detect changes
      const hasUpdates = !localContent || localContent !== githubData.content;
      
      if (hasUpdates) {
        logger.info(`Updates detected in playlist: ${playlistConfig.name}`);
        
        // Save the updated content locally
        writeFileSync(localPath, githubData.content, 'utf8');
        
        // Update the last checked timestamp
        playlistConfig.lastChecked = new Date().toISOString();
        playlistConfig.lastModified = githubData.lastModified;
        
        return {
          hasUpdates: true,
          playlistData: githubData,
          localPath
        };
      } else {
        logger.info(`No updates in playlist: ${playlistConfig.name}`);
        playlistConfig.lastChecked = new Date().toISOString();
        return { hasUpdates: false, playlistData: githubData };
      }

    } catch (error) {
      logger.error(`Error checking playlist ${playlistConfig.playlistId}:`, error);
      throw error;
    }
  }

  async checkAllPlaylists(playlistConfigs) {
    const results = [];
    
    logger.info(`Checking ${playlistConfigs.length} playlists`);

    for (const playlistConfig of playlistConfigs) {
      try {
        const result = await this.checkPlaylistForUpdates(playlistConfig);
        results.push({
          playlistId: playlistConfig.playlistId,
          playlistName: playlistConfig.name,
          ...result
        });
      } catch (error) {
        logger.error(`Failed to check playlist ${playlistConfig.playlistId}:`, error);
        results.push({
          playlistId: playlistConfig.playlistId,
          playlistName: playlistConfig.name,
          hasUpdates: false,
          playlistData: null,
          error: error.message
        });
      }
    }

    return results;
  }

  async syncPlaylistToGitHub(playlistId, content, message) {
    try {
      const githubSync = new (await import('./GitHubSync.js')).GitHubSync(
        this.config.githubToken,
        this.config.githubRepoOwner,
        this.config.githubRepoName,
        this.config.githubRepoBranch
      );

      const githubPath = `docs/${playlistId}.xml`;
      await githubSync.updateFile(githubPath, content, message);
      
      logger.info(`Successfully synced playlist ${playlistId} to GitHub`);
      return true;
    } catch (error) {
      logger.error(`Failed to sync playlist ${playlistId} to GitHub:`, error);
      throw error;
    }
  }

  parsePlaylistContent(content) {
    try {
      // Simple XML parsing to extract key information
      const titleMatch = content.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/);
      const linkMatch = content.match(/<link>([^<]+)<\/link>/);
      const descriptionMatch = content.match(/<description><!\[CDATA\[([^\]]+)\]\]><\/description>/);
      const pubDateMatch = content.match(/<pubDate>([^<]+)<\/pubDate>/);
      const lastBuildDateMatch = content.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/);
      
      // Count items
      const itemMatches = content.match(/<item>/g);
      const itemCount = itemMatches ? itemMatches.length : 0;

      return {
        title: titleMatch ? titleMatch[1] : 'Unknown',
        link: linkMatch ? linkMatch[1] : '',
        description: descriptionMatch ? descriptionMatch[1] : '',
        pubDate: pubDateMatch ? pubDateMatch[1] : '',
        lastBuildDate: lastBuildDateMatch ? lastBuildDateMatch[1] : '',
        itemCount
      };
    } catch (error) {
      logger.error('Error parsing playlist content:', error);
      return null;
    }
  }
}

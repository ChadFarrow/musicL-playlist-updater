import axios from 'axios';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';

export class GitHubSync {
  constructor(token, owner, repo, branch = 'main') {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.baseUrl = 'https://api.github.com';
    this.headers = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'musicl-playlist-updater'
    };
  }

  async getFileContent(filePath) {
    try {
      const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${filePath}`;
      const response = await axios.get(url, { headers: this.headers });
      
      if (response.data.content) {
        return Buffer.from(response.data.content, 'base64').toString('utf8');
      }
      return null;
    } catch (error) {
      if (error.response?.status === 404) {
        return null; // File doesn't exist
      }
      throw error;
    }
  }

  async updateFile(filePath, content, message) {
    try {
      // Get current file SHA if it exists
      let sha = null;
      try {
        const currentFile = await this.getFileContent(filePath);
        if (currentFile) {
          const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${filePath}`;
          const response = await axios.get(url, { headers: this.headers });
          sha = response.data.sha;
        }
      } catch (error) {
        // File doesn't exist, that's fine
      }

      const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${filePath}`;
      const data = {
        message,
        content: Buffer.from(content).toString('base64'),
        branch: this.branch
      };

      if (sha) {
        data.sha = sha;
      }

      const response = await axios.put(url, data, { headers: this.headers });
      
      logger.info(`Successfully updated ${filePath} on GitHub`);
      return response.data;
    } catch (error) {
      logger.error(`Failed to update ${filePath} on GitHub:`, error);
      throw error;
    }
  }

  async syncPlaylist(playlistPath, playlistId) {
    try {
      if (!existsSync(playlistPath)) {
        throw new Error(`Playlist file not found: ${playlistPath}`);
      }

      const content = readFileSync(playlistPath, 'utf8');
      const githubPath = `docs/${playlistId}.xml`;
      const message = `Auto-update playlist: ${playlistId}`;

      await this.updateFile(githubPath, content, message);
      
      logger.info(`Synced playlist ${playlistId} to GitHub`);
      return true;
    } catch (error) {
      logger.error(`Failed to sync playlist ${playlistId}:`, error);
      throw error;
    }
  }

  async syncAllPlaylists(playlistsDir) {
    try {
      const fs = require('fs');
      const files = fs.readdirSync(playlistsDir);
      const xmlFiles = files.filter(file => file.endsWith('.xml'));

      logger.info(`Syncing ${xmlFiles.length} playlists to GitHub`);

      const results = [];
      for (const file of xmlFiles) {
        const playlistId = file.replace('.xml', '');
        const playlistPath = join(playlistsDir, file);
        
        try {
          await this.syncPlaylist(playlistPath, playlistId);
          results.push({ playlistId, success: true });
        } catch (error) {
          results.push({ playlistId, success: false, error: error.message });
        }
      }

      return results;
    } catch (error) {
      logger.error('Failed to sync playlists to GitHub:', error);
      throw error;
    }
  }

  async createCommit(message, files) {
    try {
      // Get the latest commit SHA
      const refUrl = `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/refs/heads/${this.branch}`;
      const refResponse = await axios.get(refUrl, { headers: this.headers });
      const latestCommitSha = refResponse.data.object.sha;

      // Get the tree SHA
      const commitUrl = `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/commits/${latestCommitSha}`;
      const commitResponse = await axios.get(commitUrl, { headers: this.headers });
      const treeSha = commitResponse.data.tree.sha;

      // Create new tree with updated files
      const treeData = {
        base_tree: treeSha,
        tree: files.map(file => ({
          path: file.path,
          mode: '100644',
          type: 'blob',
          content: file.content
        }))
      };

      const treeUrl = `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/trees`;
      const treeResponse = await axios.post(treeUrl, treeData, { headers: this.headers });
      const newTreeSha = treeResponse.data.sha;

      // Create new commit
      const newCommitData = {
        message,
        tree: newTreeSha,
        parents: [latestCommitSha]
      };

      const newCommitUrl = `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/commits`;
      const newCommitResponse = await axios.post(newCommitUrl, newCommitData, { headers: this.headers });
      const newCommitSha = newCommitResponse.data.sha;

      // Update branch reference
      const updateRefData = {
        sha: newCommitSha
      };

      await axios.patch(refUrl, updateRefData, { headers: this.headers });

      logger.info(`Created commit: ${newCommitSha}`);
      return newCommitSha;
    } catch (error) {
      logger.error('Failed to create commit:', error);
      throw error;
    }
  }
}

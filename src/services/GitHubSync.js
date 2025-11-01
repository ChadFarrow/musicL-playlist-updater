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

  async getFileContent(filePath, ref = null) {
    try {
      let url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${filePath}`;
      if (ref) {
        url += `?ref=${ref}`;
      }
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

  async listDirectory(dirPath, ref = null) {
    try {
      let url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${dirPath}`;
      if (ref) {
        url += `?ref=${ref}`;
      }
      const response = await axios.get(url, { headers: this.headers });
      
      // Filter for XML files only
      const xmlFiles = response.data.filter(item => 
        item.type === 'file' && item.name.endsWith('.xml')
      );
      
      logger.info(`Found ${xmlFiles.length} XML files in ${dirPath}${ref ? ` (commit ${ref})` : ''}`);
      return xmlFiles;
    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn(`Directory not found: ${dirPath}`);
        return [];
      }
      logger.error(`Failed to list directory ${dirPath}:`, error);
      throw error;
    }
  }

  async restoreFilesFromCommit(commitSha, filePaths, message) {
    try {
      const restored = [];
      const errors = [];

      for (const filePath of filePaths) {
        try {
          // Get file content from the specified commit
          const content = await this.getFileContent(filePath, commitSha);
          if (!content) {
            logger.warn(`File not found in commit ${commitSha}: ${filePath}`);
            errors.push({ filePath, error: 'File not found in commit' });
            continue;
          }

          // Restore file to current branch
          await this.updateFile(filePath, content, `${message} - Restored from commit ${commitSha}`);
          restored.push(filePath);
          logger.info(`Restored ${filePath} from commit ${commitSha}`);
        } catch (error) {
          logger.error(`Failed to restore ${filePath}:`, error);
          errors.push({ filePath, error: error.message });
        }
      }

      return { restored, errors };
    } catch (error) {
      logger.error('Failed to restore files from commit:', error);
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

  async listDirectory(dirPath) {
    try {
      const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${dirPath}`;
      const response = await axios.get(url, { headers: this.headers });
      
      // Filter for XML files only
      const xmlFiles = response.data.filter(item => 
        item.type === 'file' && item.name.endsWith('.xml')
      );
      
      logger.info(`Found ${xmlFiles.length} XML files in ${dirPath}`);
      return xmlFiles;
    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn(`Directory not found: ${dirPath}`);
        return [];
      }
      logger.error(`Failed to list directory ${dirPath}:`, error);
      throw error;
    }
  }

  async discoverPlaylists(docsDir = 'docs') {
    try {
      const files = await this.listDirectory(docsDir);
      const playlists = [];

      for (const file of files) {
        try {
          const content = await this.getFileContent(file.path);
          if (!content) continue;

          const playlistInfo = this.parsePlaylistXML(content, file.name);
          if (playlistInfo && playlistInfo.rssUrl) {
            playlists.push(playlistInfo);
          }
        } catch (error) {
          logger.warn(`Failed to parse playlist ${file.name}:`, error.message);
        }
      }

      logger.info(`Discovered ${playlists.length} playlists with RSS feeds`);
      return playlists;
    } catch (error) {
      logger.error('Failed to discover playlists:', error);
      throw error;
    }
  }

  async getFeedsFromMarkdown() {
    try {
      const feedsMdContent = await this.getFileContent('FEEDS.md');
      if (!feedsMdContent) {
        logger.warn('FEEDS.md not found in target repository');
        return [];
      }

      logger.info('Found FEEDS.md, parsing feed list...');
      const feedList = this.parseFeedsMarkdown(feedsMdContent);
      logger.info(`Parsed ${feedList.length} feed(s) from FEEDS.md`);
      return feedList;
    } catch (error) {
      logger.error('Failed to fetch or parse FEEDS.md:', error);
      return [];
    }
  }

  parseFeedsMarkdown(markdownContent) {
    const feeds = [];
    const lines = markdownContent.split('\n');

    for (const line of lines) {
      // Look for playlist IDs in various formats:
      // - Bullet points: "- playlist-id" or "* playlist-id"
      // - Numbered lists: "1. **playlist-id.xml**" or "1. playlist-id"
      // - Links: "[name](url)" or plain playlist-id
      // - Table rows
      // - Code blocks or inline code

      let playlistId = null;
      
      // Try to match numbered lists with bold text: "1. **playlist-name.xml**"
      const numberedBoldMatch = line.match(/^[\s]*\d+[\.)][\s]*\*\*([\w-]+(?:-music-playlist)?)(?:\.xml)?\*\*/i);
      if (numberedBoldMatch) {
        playlistId = numberedBoldMatch[1].replace(/\.xml$/i, '');
      }

      // Try to match bullet points with playlist IDs
      if (!playlistId) {
        const bulletMatch = line.match(/^[\s]*[-*+][\s]+([\w-]+(?:-music-playlist)?)(?:\.xml)?/i);
        if (bulletMatch) {
          playlistId = bulletMatch[1].replace(/\.xml$/i, '');
        }
      }

      // Try to match numbered lists without bold
      if (!playlistId) {
        const numberedMatch = line.match(/^[\s]*\d+[\.)][\s]+([\w-]+(?:-music-playlist)?)(?:\.xml)?/i);
        if (numberedMatch) {
          playlistId = numberedMatch[1].replace(/\.xml$/i, '');
        }
      }

      // Try to match table rows (pipe-separated)
      if (!playlistId) {
        const tableMatch = line.match(/\|[\s]*([\w-]+(?:-music-playlist)?)(?:\.xml)?[\s]*\|/i);
        if (tableMatch) {
          playlistId = tableMatch[1].replace(/\.xml$/i, '');
        }
      }

      // Try to match plain playlist IDs (standalone on line)
      if (!playlistId) {
        const plainMatch = line.match(/^[\s]*([\w-]+(?:-music-playlist)?)(?:\.xml)?[\s]*$/i);
        if (plainMatch && !line.startsWith('#') && !line.trim().startsWith('[')) {
          playlistId = plainMatch[1].replace(/\.xml$/i, '');
        }
      }

      // Skip if it's not a playlist ID (headers, code blocks, etc.)
      // Also skip publisher feed and common words
      // Allow playlists with -music-playlist, -muic-playlist (typo), or -musicl- patterns
      if (playlistId && 
          !playlistId.match(/^(feeds|playlist|playlists|id|name|rss|url|publisher|chadf-musicl-publisher|some|all|available|notes|directory|format|files|located)$/i) &&
          playlistId.length > 3 &&
          !playlistId.includes('publisher') &&
          (playlistId.includes('-music-playlist') || 
           playlistId.includes('-muic-playlist') || 
           playlistId.includes('-musicl-'))) {
        feeds.push(playlistId);
      }
    }

    // Deduplicate
    return [...new Set(feeds)];
  }

  parsePlaylistXML(xmlContent, fileName) {
    try {
      // Extract playlistId from filename
      const playlistId = fileName.replace('.xml', '');

      // Extract RSS feed URL from podcast:txt tag
      const sourceFeedMatch = xmlContent.match(/<podcast:txt\s+purpose=["']source-(?:feed|rss)["']>([^<]+)<\/podcast:txt>/i);
      const rssUrl = sourceFeedMatch ? sourceFeedMatch[1].trim() : null;

      if (!rssUrl) {
        logger.debug(`No source RSS feed found in ${fileName}`);
        return null;
      }

      // Extract metadata
      const titleMatch = xmlContent.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/) || 
                        xmlContent.match(/<title>([^<]+)<\/title>/);
      const title = titleMatch ? titleMatch[1] : playlistId;

      const descriptionMatch = xmlContent.match(/<description><!\[CDATA\[([^\]]+)\]\]><\/description>/) ||
                               xmlContent.match(/<description>([^<]+)<\/description>/);
      const description = descriptionMatch ? descriptionMatch[1] : `Playlist: ${title}`;

      const authorMatch = xmlContent.match(/<managingEditor>([^<]+)<\/managingEditor>/) ||
                         xmlContent.match(/<author>([^<]+)<\/author>/) ||
                         xmlContent.match(/<copyright><!\[CDATA\[([^\]]+)\]\]><\/copyright>/);
      const author = authorMatch ? authorMatch[1] : 'ChadFarrow';

      const imageMatch = xmlContent.match(/<image>[\s\S]*?<url>([^<]+)<\/url>[\s\S]*?<\/image>/);
      const imageUrl = imageMatch ? imageMatch[1] : '';

      return {
        playlistId,
        rssUrl,
        playlistTitle: title,
        playlistDescription: description,
        playlistAuthor: author,
        playlistImageUrl: imageUrl,
        fileName
      };
    } catch (error) {
      logger.error(`Failed to parse XML for ${fileName}:`, error);
      return null;
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

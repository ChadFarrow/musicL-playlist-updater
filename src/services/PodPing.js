import axios from 'axios';
import { logger } from '../utils/logger.js';

export class PodPing {
  constructor(config = {}) {
    this.enabled = config.enabled !== false; // Default to enabled if not specified
    this.endpoint = config.endpoint || 'https://podping.cloud';
    this.timeout = config.timeout || 5000;
    this.hivePostingKey = config.hivePostingKey || null;
    this.hiveUsername = config.hiveUsername || null;
  }

  /**
   * Send a PodPing notification for an RSS feed update
   * @param {string} feedUrl - The RSS feed URL that was updated
   * @returns {Promise<{success: boolean, message?: string}>}
   */
  async sendNotification(feedUrl) {
    if (!this.enabled) {
      logger.debug('PodPing notifications are disabled');
      return { success: false, message: 'PodPing disabled' };
    }

    if (!feedUrl) {
      logger.warn('PodPing: Cannot send notification - feed URL is empty');
      return { success: false, message: 'Feed URL is empty' };
    }

    // Check if authentication is configured
    if (!this.hivePostingKey || !this.hiveUsername) {
      logger.warn('PodPing: Hive credentials not configured. PodPing requires Hive Posting Key and Username for authentication.');
      logger.warn('PodPing: Add hivePostingKey and hiveUsername to config.json podping section');
      return { success: false, message: 'Hive credentials not configured' };
    }

    try {
      logger.info(`Sending PodPing notification for feed: ${feedUrl}`);
      
      // Try POST request with JSON body first (common pattern for authenticated APIs)
      // If that fails, we can try GET with query parameters
      const headers = {
        'Content-Type': 'application/json'
      };
      
      if (this.hivePostingKey && this.hiveUsername) {
        // Try POST with JSON body containing auth credentials
        const url = this.endpoint;
        const body = {
          url: feedUrl,
          username: this.hiveUsername,
          postingKey: this.hivePostingKey
        };
        
        try {
          const response = await axios.post(url, body, {
            headers: headers,
            timeout: this.timeout,
            validateStatus: (status) => status < 500
          });
          
          if (response.status >= 200 && response.status < 300) {
            logger.info(`PodPing notification sent successfully for ${feedUrl}`);
            return { success: true, message: 'Notification sent' };
          } else if (response.status === 401) {
            // If POST with JSON body fails, try GET with query parameters
            logger.debug(`PodPing POST returned ${response.status}, trying GET with query params`);
            return await this.tryGetRequest(feedUrl);
          } else {
            logger.warn(`PodPing notification returned status ${response.status} for ${feedUrl}`);
            return { success: false, message: `Status ${response.status}` };
          }
        } catch (postError) {
          // If POST fails with network error or 401, try GET
          if (postError.response?.status === 401 || !postError.response) {
            logger.debug(`PodPing POST failed: ${postError.message}, trying GET with query params`);
            return await this.tryGetRequest(feedUrl);
          }
          throw postError;
        }
      } else {
        // No auth - try simple GET request
        return await this.tryGetRequest(feedUrl);
      }
    } catch (error) {
      // Non-fatal error - log warning but don't throw
      logger.warn(`Failed to send PodPing notification for ${feedUrl}: ${error.message}`);
      
      // Don't log stack trace for network errors unless debug mode
      if (process.env.LOG_LEVEL === 'debug' || logger.level === 'debug') {
        logger.debug(`PodPing error stack: ${error.stack}`);
      }
      
      return { success: false, message: error.message };
    }
  }

  /**
   * Try GET request with query parameters (fallback method)
   * @private
   */
  async tryGetRequest(feedUrl) {
    const url = `${this.endpoint}?url=${encodeURIComponent(feedUrl)}`;
    
    const headers = {};
    if (this.hivePostingKey && this.hiveUsername) {
      // Try different header formats
      headers['X-Hive-Username'] = this.hiveUsername;
      headers['X-Hive-Posting-Key'] = this.hivePostingKey;
      // Also try alternative header names
      headers['Hive-Username'] = this.hiveUsername;
      headers['Hive-Posting-Key'] = this.hivePostingKey;
      // Try with Authorization header
      headers['Authorization'] = `Hive ${this.hiveUsername}:${this.hivePostingKey}`;
    }
    
    // Also try with query parameters
    let urlWithAuth = url;
    if (this.hivePostingKey && this.hiveUsername) {
      urlWithAuth = `${this.endpoint}?url=${encodeURIComponent(feedUrl)}&username=${encodeURIComponent(this.hiveUsername)}&postingKey=${encodeURIComponent(this.hivePostingKey)}`;
    }
    
    try {
      const response = await axios.get(urlWithAuth, {
        headers: headers,
        timeout: this.timeout,
        validateStatus: (status) => status < 500
      });
      
      if (response.status >= 200 && response.status < 300) {
        logger.info(`PodPing notification sent successfully for ${feedUrl}`);
        return { success: true, message: 'Notification sent' };
      } else {
        logger.warn(`PodPing notification returned status ${response.status} for ${feedUrl}`);
        
        // Provide helpful error message for 401
        if (response.status === 401) {
          logger.warn('PodPing: Authentication failed. Please verify your Hive Posting Key and Username are correct.');
          logger.warn('PodPing: Ensure your Hive account is authorized to send PodPing notifications.');
          logger.warn('PodPing: The podping.cloud API format may require different authentication. Please check PodPing documentation.');
        }
        
        return { success: false, message: `Status ${response.status}` };
      }
    } catch (error) {
      logger.warn(`PodPing GET request failed: ${error.message}`);
      return { success: false, message: error.message };
    }
  }
}


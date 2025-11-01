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
      // PodPing uses a GET request with the feed URL as a query parameter
      // Authentication may be handled via headers or query parameters depending on podping.cloud implementation
      const url = `${this.endpoint}?url=${encodeURIComponent(feedUrl)}`;
      
      logger.info(`Sending PodPing notification for feed: ${feedUrl}`);
      
      // Try with authentication headers (if podping.cloud supports it)
      const headers = {};
      if (this.hivePostingKey && this.hiveUsername) {
        // podping.cloud may require authentication - trying with headers first
        // Note: Actual auth format may vary - this is a common pattern
        headers['X-Hive-Username'] = this.hiveUsername;
        headers['X-Hive-Posting-Key'] = this.hivePostingKey;
      }
      
      const response = await axios.get(url, {
        headers: headers,
        timeout: this.timeout,
        validateStatus: (status) => status < 500 // Accept any status code < 500
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
        }
        
        return { success: false, message: `Status ${response.status}` };
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
}


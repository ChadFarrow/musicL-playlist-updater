import axios from 'axios';
import { logger } from '../utils/logger.js';

export class PodPing {
  constructor(config = {}) {
    this.enabled = config.enabled !== false; // Default to enabled if not specified
    this.endpoint = config.endpoint || 'https://podping.cloud';
    this.timeout = config.timeout || 5000;
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

    try {
      // PodPing uses a GET request with the feed URL as a query parameter
      const url = `${this.endpoint}?url=${encodeURIComponent(feedUrl)}`;
      
      logger.info(`Sending PodPing notification for feed: ${feedUrl}`);
      
      const response = await axios.get(url, {
        timeout: this.timeout,
        validateStatus: (status) => status < 500 // Accept any status code < 500
      });

      if (response.status >= 200 && response.status < 300) {
        logger.info(`PodPing notification sent successfully for ${feedUrl}`);
        return { success: true, message: 'Notification sent' };
      } else {
        logger.warn(`PodPing notification returned status ${response.status} for ${feedUrl}`);
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


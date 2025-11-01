import { Client, PrivateKey } from '@hiveio/dhive';
import { logger } from '../utils/logger.js';

export class PodPing {
  constructor(config = {}) {
    this.enabled = config.enabled !== false; // Default to enabled if not specified
    this.timeout = config.timeout || 10000; // Hive operations can take longer
    this.hivePostingKey = config.hivePostingKey || null;
    this.hiveUsername = config.hiveUsername || null;
    this.hiveNode = config.hiveNode || 'https://api.hive.blog'; // Default Hive node
    
    // Initialize Hive client
    if (this.enabled && this.hivePostingKey && this.hiveUsername) {
      this.client = new Client([this.hiveNode], {
        chainId: 'beeab0de00000000000000000000000000000000000000000000000000000000' // Hive mainnet chain ID
      });
    } else {
      this.client = null;
    }
  }

  /**
   * Send a PodPing notification for an RSS feed update
   * This broadcasts a custom_json operation on the Hive blockchain
   * Based on the official PodPing format: https://github.com/Podcastindex-org/podping-hivewriter
   * @param {string} feedUrl - The RSS feed URL that was updated
   * @param {string} reason - The reason for the ping: "update", "live", or "liveEnd" (default: "update")
   * @returns {Promise<{success: boolean, message?: string, transactionId?: string}>}
   */
  async sendNotification(feedUrl, reason = 'update') {
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

    if (!this.client) {
      logger.warn('PodPing: Hive client not initialized');
      return { success: false, message: 'Hive client not initialized' };
    }

    try {
      logger.info(`Sending PodPing notification for feed: ${feedUrl}`);
      
      // Create PodPing custom_json operation
      // Format based on podping-hivewriter: https://github.com/Podcastindex-org/podping-hivewriter
      // The custom_json id is "podping", and the JSON contains version, reasons, and urls
      const customJson = {
        version: '1.0',
        reasons: [reason], // "update", "live", or "liveEnd"
        urls: [feedUrl]
      };

      // Validate reason
      const validReasons = ['update', 'live', 'liveEnd'];
      if (!validReasons.includes(reason)) {
        logger.warn(`PodPing: Invalid reason "${reason}", defaulting to "update"`);
        customJson.reasons = ['update'];
      }

      logger.debug(`PodPing custom_json: ${JSON.stringify(customJson)}`);

      // Create private key from posting key string
      const privateKey = PrivateKey.fromString(this.hivePostingKey);

      // Create the operation
      const operations = [
        [
          'custom_json',
          {
            required_auths: [],
            required_posting_auths: [this.hiveUsername],
            id: 'podping',
            json: JSON.stringify(customJson)
          }
        ]
      ];

      logger.info(`Broadcasting PodPing transaction to Hive blockchain for user: ${this.hiveUsername}`);

      // Broadcast the transaction
      const result = await this.client.broadcast.sendOperations(operations, privateKey);

      if (result && result.id) {
        logger.info(`PodPing notification sent successfully! Transaction ID: ${result.id}`);
        logger.info(`Feed URL: ${feedUrl}`);
        return { 
          success: true, 
          message: 'Notification sent',
          transactionId: result.id
        };
      } else {
        logger.warn(`PodPing broadcast returned unexpected result: ${JSON.stringify(result)}`);
        return { success: false, message: 'Unexpected broadcast result' };
      }
    } catch (error) {
      // Non-fatal error - log warning but don't throw
      logger.warn(`Failed to send PodPing notification for ${feedUrl}: ${error.message}`);
      
      // Log more details for debugging
      if (process.env.LOG_LEVEL === 'debug' || logger.level === 'debug') {
        logger.debug(`PodPing error stack: ${error.stack}`);
        logger.debug(`PodPing error details: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
      }
      
      // Provide helpful error messages
      if (error.message && error.message.includes('private key')) {
        logger.warn('PodPing: Invalid Hive posting key. Please verify your posting key is correct.');
      } else if (error.message && error.message.includes('insufficient')) {
        logger.warn('PodPing: Insufficient Hive resources. Your account may need more Resource Credits (RC).');
      } else if (error.message && error.message.includes('network') || error.message && error.message.includes('timeout')) {
        logger.warn('PodPing: Network error. Please check your internet connection and Hive node availability.');
      }
      
      return { success: false, message: error.message };
    }
  }
}

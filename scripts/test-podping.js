import { readFileSync } from 'fs';
import { PodPing } from '../src/services/PodPing.js';
import { logger } from '../src/utils/logger.js';

// Load configuration (optional)
let config = {};
try {
  const configData = readFileSync('./config.json', 'utf8');
  config = JSON.parse(configData);
  logger.info('Loaded config.json');
} catch (error) {
  if (error.code === 'ENOENT') {
    logger.info('config.json not found, using environment variables');
  } else {
    logger.error('Failed to load config.json:', error);
  }
}

// Build PodPing configuration
const podpingConfig = {
  enabled: config.podping?.enabled !== false,
  endpoint: config.podping?.endpoint || 'https://podping.cloud',
  timeout: config.podping?.timeout || 5000,
  hiveUsername: process.env.HIVE_USERNAME || config.podping?.hiveUsername || '',
  hivePostingKey: process.env.HIVE_POSTING_KEY || config.podping?.hivePostingKey || ''
};

// Test feed URL - you can change this to any feed URL you want to test
const testFeedUrl = process.argv[2] || 'https://feed.homegrownhits.xyz/feed.xml';

logger.info('=== PodPing Test Script ===');
logger.info(`Endpoint: ${podpingConfig.endpoint}`);
logger.info(`Hive Username: ${podpingConfig.hiveUsername ? podpingConfig.hiveUsername.substring(0, 3) + '***' : 'NOT SET'}`);
logger.info(`Hive Posting Key: ${podpingConfig.hivePostingKey ? podpingConfig.hivePostingKey.substring(0, 5) + '***' : 'NOT SET'}`);
logger.info(`Test Feed URL: ${testFeedUrl}`);
logger.info('');

if (!podpingConfig.hiveUsername || !podpingConfig.hivePostingKey) {
  logger.error('ERROR: Hive credentials not configured!');
  logger.error('Set HIVE_USERNAME and HIVE_POSTING_KEY environment variables,');
  logger.error('or add them to config.json in the podping section.');
  process.exit(1);
}

// Initialize PodPing
const podping = new PodPing(podpingConfig);

// Test sending notification
logger.info('Sending PodPing notification...');
logger.info('');

podping.sendNotification(testFeedUrl)
  .then(result => {
    logger.info('');
    logger.info('=== Test Result ===');
    if (result.success) {
      logger.info('✓ SUCCESS: PodPing notification sent successfully!');
      logger.info(`Message: ${result.message}`);
    } else {
      logger.info('✗ FAILED: PodPing notification failed');
      logger.info(`Message: ${result.message}`);
      logger.info('');
      logger.info('Common issues:');
      logger.info('- Check that your Hive credentials are correct');
      logger.info('- Verify the PodPing endpoint URL is correct');
      logger.info('- Check PodPing documentation for the correct API format');
    }
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    logger.error('');
    logger.error('=== Error ===');
    logger.error('Unexpected error:', error.message);
    logger.error(error.stack);
    process.exit(1);
  });


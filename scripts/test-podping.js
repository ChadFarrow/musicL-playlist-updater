// Sends one PodPing through the msp-podping-service pusher.
//
//   PODPING_ENDPOINT_URL=… PODPING_BEARER_TOKEN=… \
//     node scripts/test-podping.js <feed-url> [--medium musicL] [--reason update] [--broadcast]
//
// Without --broadcast the pusher only queues it (hivepinger's no_broadcast), so
// nothing reaches Hive. The feed URL is required: a test must not ping a feed
// that is not yours.
import { readFileSync } from 'fs';
import { PodPing, podpingConfigFrom } from '../src/services/PodPing.js';
import { logger } from '../src/utils/logger.js';

let config = {};
try {
  config = JSON.parse(readFileSync('./config.json', 'utf8'));
  logger.info('Loaded config.json');
} catch (error) {
  if (error.code !== 'ENOENT') logger.error('Failed to load config.json:', error);
}

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const feedUrl = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.match(/^--(medium|reason)$/));
const medium = option('medium', 'podcast');
const reason = option('reason', 'update');
const broadcast = args.includes('--broadcast');

if (!feedUrl) {
  logger.error('Usage: node scripts/test-podping.js <feed-url> [--medium musicL] [--reason update] [--broadcast]');
  process.exit(1);
}

const podpingConfig = podpingConfigFrom(config);
logger.info(`Pusher: ${podpingConfig.endpointUrl || 'NOT SET'}; token ${podpingConfig.bearerToken ? 'set' : 'NOT SET'}`);
logger.info(`Feed: ${feedUrl} (${medium}/${reason}) — ${broadcast ? 'BROADCAST to Hive' : 'queue only, no broadcast'}`);

const result = await new PodPing(podpingConfig).sendNotification(feedUrl, { medium, reason, noBroadcast: !broadcast });
logger.info(`${result.success ? 'OK' : 'FAILED'}: ${result.message}`);
process.exit(result.success ? 0 : 1);

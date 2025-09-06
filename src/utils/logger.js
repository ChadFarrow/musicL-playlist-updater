import winston from 'winston';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Ensure logs directory exists
const logsDir = './logs';
if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

// Create logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'musicl-playlist-updater' },
  transports: [
    // Write all logs to console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // Write all logs to file
    new winston.transports.File({ 
      filename: join(logsDir, 'error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: join(logsDir, 'combined.log') 
    })
  ]
});

// Add a method for structured logging
logger.logUpdate = (feedName, episodeCount, action = 'updated') => {
  logger.info('Playlist update', {
    feed: feedName,
    episodes: episodeCount,
    action,
    timestamp: new Date().toISOString()
  });
};

logger.logError = (context, error) => {
  logger.error('Error occurred', {
    context,
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
};

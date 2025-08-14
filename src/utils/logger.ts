import winston from 'winston';
import { appConfig } from './config';

// Custom log format for Cloud Run
const cloudRunFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    return JSON.stringify({
      timestamp,
      severity: level.toUpperCase(),
      message,
      ...meta
    });
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: appConfig.logLevel,
  format: appConfig.nodeEnv === 'production' 
    ? cloudRunFormat 
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
  transports: [
    new winston.transports.Console()
  ]
});

// Add file transport in development
if (appConfig.nodeEnv === 'development') {
  logger.add(new winston.transports.File({ 
    filename: 'logs/error.log', 
    level: 'error' 
  }));
  logger.add(new winston.transports.File({ 
    filename: 'logs/combined.log' 
  }));
}

export default logger;
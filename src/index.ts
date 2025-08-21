// Must be first import to set up module aliases
import 'module-alias/register';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { appConfig } from '@/utils/config';
import logger from '@/utils/logger';
import TokenHealthScheduler from '@/scheduler/token-health-scheduler';

// Import routes
import healthRouter from '@/api/health';
import syncRouter from '@/api/sync';
import statusRouter from '@/api/status';
import metricsRouter from '@/api/metrics';
import tokenHealthRouter from '@/api/token-health';

// Import middleware
import { authMiddleware } from '@/api/middleware/auth';
import { errorHandler } from '@/api/middleware/error-handler';

const app = express();

// Initialize token health scheduler
const tokenHealthScheduler = new TokenHealthScheduler();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Performance middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.headers['x-request-id']
  });
  next();
});

// Routes
app.use('/health', healthRouter);
app.use('/api/token-health', authMiddleware, tokenHealthRouter);
app.use('/api', authMiddleware, syncRouter);
app.use('/api', authMiddleware, statusRouter);
app.use('/api', authMiddleware, metricsRouter);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

// Error handling middleware
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
const server = app.listen(appConfig.port, () => {
  logger.info(`🚀 Lengolf Ads ETL service started`, {
    port: appConfig.port,
    environment: appConfig.nodeEnv,
    version: process.env.npm_package_version || '1.0.0'
  });

  // Start token health monitoring
  try {
    tokenHealthScheduler.start();
    logger.info('✅ Token health monitoring started');
  } catch (error) {
    logger.error('❌ Failed to start token health monitoring', { error });
  }
});

// Handle server errors
server.on('error', (error: any) => {
  if (error.syscall !== 'listen') {
    throw error;
  }

  switch (error.code) {
    case 'EACCES':
      logger.error(`Port ${appConfig.port} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      logger.error(`Port ${appConfig.port} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
});

export default app;
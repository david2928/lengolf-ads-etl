import { Router, Request, Response } from 'express';
import logger from '@/utils/logger';
import { createClient } from '@supabase/supabase-js';
import { appConfig } from '@/utils/config';
import { getErrorMessage } from '@/utils/error-handler';

const router = Router();

// Initialize Supabase client for health check
const supabase = createClient(appConfig.supabaseUrl, appConfig.supabaseServiceKey);

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  version: string;
  environment: string;
  services: {
    database: 'up' | 'down';
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    uptime: number;
  };
  checks?: {
    [key: string]: boolean;
  };
}

router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    // Check database connectivity
    const { error: dbError } = await supabase
      .schema('marketing')
      .from('etl_sync_log')
      .select('id')
      .limit(1);

    // Memory usage
    const memUsage = process.memoryUsage();
    const memoryPercentage = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);

    const healthStatus: HealthStatus = {
      status: dbError ? 'unhealthy' : 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: appConfig.nodeEnv,
      services: {
        database: dbError ? 'down' : 'up',
        memory: {
          used: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
          total: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
          percentage: memoryPercentage
        },
        uptime: Math.round(process.uptime())
      }
    };

    // Additional health checks
    if (req.query.detailed === 'true') {
      healthStatus.checks = {
        canConnectToDatabase: !dbError,
        memoryUsageNormal: memoryPercentage < 90,
        environmentVariablesLoaded: !!appConfig.supabaseUrl && !!appConfig.etlApiKey
      };
    }

    const responseTime = Date.now() - startTime;
    
    logger.info('Health check completed', {
      status: healthStatus.status,
      responseTime,
      databaseStatus: healthStatus.services.database
    });

    res.status(healthStatus.status === 'healthy' ? 200 : 503).json(healthStatus);

  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('Health check failed', { error: errorMessage });
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: appConfig.nodeEnv,
      error: errorMessage,
      services: {
        database: 'down',
        memory: {
          used: 0,
          total: 0,
          percentage: 0
        },
        uptime: Math.round(process.uptime())
      }
    });
  }
});

// Liveness probe (simpler check)
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString()
  });
});

// Readiness probe (checks if service is ready to handle requests)
router.get('/ready', async (req: Request, res: Response) => {
  try {
    // Quick database connectivity check
    const { error } = await supabase
      .schema('marketing')
      .from('etl_sync_log')
      .select('id')
      .limit(1);

    if (error) {
      return res.status(503).json({
        status: 'not_ready',
        reason: 'database_unavailable',
        timestamp: new Date().toISOString()
      });
    }

    return res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return res.status(503).json({
      status: 'not_ready',
      reason: getErrorMessage(error),
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
import { Request, Response, NextFunction } from 'express';
import { appConfig } from '@/utils/config';
import logger from '@/utils/logger';

interface AuthenticatedRequest extends Request {
  isAuthenticated?: boolean;
}

export const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Skip auth for health checks
  if (req.path.startsWith('/health')) {
    return next();
  }

  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    logger.warn('Missing authorization header', {
      path: req.path,
      ip: req.ip
    });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authorization header required'
    });
  }

  const token = authHeader.startsWith('Bearer ') 
    ? authHeader.slice(7)
    : authHeader;

  if (token !== appConfig.etlApiKey) {
    logger.warn('Invalid API key', {
      path: req.path,
      ip: req.ip,
      tokenPrefix: token.substring(0, 8) + '...'
    });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key'
    });
  }

  req.isAuthenticated = true;
  next();
};
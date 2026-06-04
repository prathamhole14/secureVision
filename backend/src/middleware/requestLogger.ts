import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function requestLogger(req: Request, _res: Response, next: NextFunction) {
  logger.debug(`→ ${req.method} ${req.originalUrl}`);
  next();
}

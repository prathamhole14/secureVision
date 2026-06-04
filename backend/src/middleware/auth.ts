import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';

export interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      email: string;
      role: string;
    };
    req.user = decoded;
    next();
  } catch (err) {
    logger.warn(`Invalid JWT: ${(err as Error).message}`);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

export function requireRole(role: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || req.user.role !== role) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      return;
    }
    next();
  };
}

export async function requireActiveSession(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const sessionId = req.params.sessionId || req.body.sessionId;
  if (!sessionId) {
    res.status(400).json({ error: 'Session ID required' });
    return;
  }
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== req.user?.id) {
    res.status(403).json({ error: 'Forbidden: Session not owned by user' });
    return;
  }
  next();
}

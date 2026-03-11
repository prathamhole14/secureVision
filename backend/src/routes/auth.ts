import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt, { SignOptions } from 'jsonwebtoken';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { z } from 'zod';

const router = Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const GoogleAuthSchema = z.object({
  id_token: z.string().min(1),
});

function signToken(payload: object): string {
  const opts: SignOptions = { expiresIn: '24h' };
  return jwt.sign(payload, process.env.JWT_SECRET!, opts);
}

/**
 * POST /api/auth/google
 * Verifies a Google ID token and returns a JWT.
 * In dev mode, 'demo-professor-token' and 'demo-student-token' bypass real OAuth.
 */
router.post('/google', async (req: Request, res: Response) => {
  const body = GoogleAuthSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'id_token is required' });
    return;
  }

  // -------- DEV-MODE BYPASS --------
  if (process.env.NODE_ENV !== 'production') {
    const demoMap: Record<string, string> = {
      'demo-professor-token': 'professor@university.edu',
      'demo-student-token':   'student@university.edu',
    };
    const demoEmail = demoMap[body.data.id_token];
    if (demoEmail) {
      const user = await prisma.user.findUnique({ where: { email: demoEmail } });
      if (user) {
        const token = signToken({ id: user.id, email: user.email, role: user.role });
        logger.info(`[DEV] Demo login as ${user.email} (${user.role})`);
        res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
        return;
      }
    }
  }
  // -------- END DEV-MODE BYPASS --------

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: body.data.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload?.sub || !payload?.email) {
      res.status(401).json({ error: 'Invalid Google token payload' });
      return;
    }

    let user = await prisma.user.findUnique({ where: { googleId: payload.sub } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          googleId: payload.sub,
          name: payload.name || payload.email,
          email: payload.email,
          role: 'STUDENT',
        },
      });
      logger.info(`New user registered: ${user.email}`);
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    logger.error(`Google auth error: ${(err as Error).message}`);
    res.status(401).json({ error: 'Google token verification failed' });
  }
});

/**
 * GET /api/auth/me
 * Returns current user info from JWT.
 */
router.get('/me', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET!) as { id: string };
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;

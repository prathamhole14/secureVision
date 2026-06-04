import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt, { SignOptions } from 'jsonwebtoken';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const router = Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const RegisterSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['STUDENT', 'PROFESSOR']).default('STUDENT'),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
const GoogleAuthSchema = z.object({
  id_token: z.string().min(1),
});
function signToken(payload: object): string {
  const opts: SignOptions = { expiresIn: '24h' };
  return jwt.sign(payload, process.env.JWT_SECRET!, opts);
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  const body = RegisterSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() });
    return;
  }

  const { name, email, password, role } = body.data;

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: passwordHash,
        role,
      },
    });

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    logger.error(`Registration error: ${(err as Error).message}`);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const body = LoginSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() });
    return;
  }

  const { email, password } = body.data;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    logger.error(`Login error: ${(err as Error).message}`);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

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
    const demoMap: Record<string, { email: string; name: string; role: 'STUDENT' | 'PROFESSOR' }> = {
      'demo-professor-token': { email: 'professor@university.edu', name: 'Tester Professor 1', role: 'PROFESSOR' },
      'demo-student-token': { email: 'student@university.edu', name: 'Tester Student 1', role: 'STUDENT' },
    };
    const demoUserConfig = demoMap[body.data.id_token];
    if (demoUserConfig) {
      let user = await prisma.user.findUnique({ where: { email: demoUserConfig.email } });
      if (!user) {
        const passwordHash = await bcrypt.hash('password123', 10);
        user = await prisma.user.create({
          data: {
            email: demoUserConfig.email,
            name: demoUserConfig.name,
            role: demoUserConfig.role,
            password: passwordHash,
          },
        });
        logger.info(`[DEV] Created new demo user ${user.email} (${user.role})`);
      }
      const token = signToken({ id: user.id, email: user.email, role: user.role });
      logger.info(`[DEV] Demo login as ${user.email} (${user.role})`);
      res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
      return;
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

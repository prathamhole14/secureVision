import { Router, Response } from 'express';
import { prisma } from '../utils/prismaClient';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const CreateExamSchema = z.object({
  title: z.string().min(1).max(200),
  duration: z.number().int().positive(),
  startTime: z.string().datetime().optional(),
  config: z.object({
    questions: z.array(z.record(z.unknown())),
    policy: z.object({
      lowSeverityAction: z.enum(['warn', 'log']),
      mediumSeverityAction: z.enum(['pause', 'warn']),
      highSeverityAction: z.enum(['submit', 'lock']),
    }),
    webcamRequired: z.boolean().optional().default(false),
    allowedResources: z.string().optional().default('none'),
    totalPoints: z.number().optional(),
  }),
});

// GET /api/exams — list exams (professors see own, students see active)
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const exams =
    req.user?.role === 'PROFESSOR'
      ? await prisma.exam.findMany({
          where: { ownerId: req.user!.id },
          include: { _count: { select: { sessions: true } } },
          orderBy: { createdAt: 'desc' },
        })
      : await prisma.exam.findMany({
          where: { isActive: true },
          select: { id: true, title: true, duration: true, startTime: true },
          orderBy: { startTime: 'asc' },
        });
  res.json({ exams });
});

// POST /api/exams — create a new exam (professor only)
router.post(
  '/',
  requireAuth,
  requireRole('PROFESSOR'),
  async (req: AuthRequest, res: Response) => {
    const body = CreateExamSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() });
      return;
    }
    const exam = await prisma.exam.create({
      data: {
        ownerId: req.user!.id,
        title: body.data.title,
        duration: body.data.duration,
        startTime: body.data.startTime ? new Date(body.data.startTime) : undefined,
        configJson: JSON.stringify(body.data.config),
      },
    });
    res.status(201).json({ exam });
  }
);

// GET /api/exams/:id — fetch exam config
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
  if (!exam) {
    res.status(404).json({ error: 'Exam not found' });
    return;
  }
  // Students only get safe fields (no answer keys)
  if (req.user?.role === 'STUDENT') {
    const { configJson, ...safeExam } = exam;
    const config = configJson as Record<string, unknown>;
    const safeConfig = {
      ...config,
      questions: (config.questions as Array<Record<string, unknown>>)?.map((q) => {
        const { answer, ...safeQ } = q; // strip answer field
        void answer;
        return safeQ;
      }),
    };
    res.json({ exam: { ...safeExam, config: safeConfig } });
    return;
  }
  res.json({ exam });
});

// PATCH /api/exams/:id — update exam (professor only)
router.patch(
  '/:id',
  requireAuth,
  requireRole('PROFESSOR'),
  async (req: AuthRequest, res: Response) => {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam || exam.ownerId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }
    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: {
        isActive: req.body.isActive ?? exam.isActive,
        title: req.body.title ?? exam.title,
      },
    });
    res.json({ exam: updated });
  }
);

// DELETE /api/exams/:id
router.delete(
  '/:id',
  requireAuth,
  requireRole('PROFESSOR'),
  async (req: AuthRequest, res: Response) => {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam || exam.ownerId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }
    await prisma.exam.delete({ where: { id: req.params.id } });
    res.json({ message: 'Exam deleted' });
  }
);

// POST /api/exams/:id/start — student starts an exam, gets a session token
router.post('/:id/start', requireAuth, async (req: AuthRequest, res: Response) => {
  const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
  if (!exam || !exam.isActive) {
    res.status(404).json({ error: 'Exam not found or not active' });
    return;
  }

  // Check for existing active session
  const existingSession = await prisma.session.findFirst({
    where: {
      examId: exam.id,
      userId: req.user!.id,
      status: 'ACTIVE',
    },
  });
  if (existingSession) {
    res.json({ sessionToken: existingSession.sessionToken, sessionId: existingSession.id });
    return;
  }

  const session = await prisma.session.create({
    data: {
      examId: exam.id,
      userId: req.user!.id,
      sessionToken: uuidv4(),
      status: 'PENDING',
    },
  });

  res.status(201).json({
    sessionId: session.id,
    sessionToken: session.sessionToken,
    examConfig: exam.configJson,
    duration: exam.duration,
  });
});

export default router;

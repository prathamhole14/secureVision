import { Router, Response } from 'express';
import { prisma } from '../utils/prismaClient';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * GET /api/reports/:sessionId
 * Professor or admin can view a full session report.
 */
router.get(
  '/:sessionId',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    const session = await prisma.session.findUnique({
      where: { id: req.params.sessionId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        exam: { select: { id: true, title: true, ownerId: true } },
        events: { orderBy: { timestamp: 'asc' } },
        flags: { orderBy: { createdAt: 'asc' } },
        artifacts: true,
      },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Only the exam owner or the student themselves
    if (
      session.exam.ownerId !== req.user!.id &&
      session.userId !== req.user!.id &&
      req.user!.role !== 'ADMIN'
    ) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const summary = {
      totalEvents: session.events.length,
      flagCount: session.flags.length,
      highSeverityFlags: session.flags.filter((f) => f.severity === 'HIGH').length,
      mediumSeverityFlags: session.flags.filter((f) => f.severity === 'MEDIUM').length,
      artifactCount: session.artifacts.length,
    };

    res.json({ session, summary });
  }
);

/**
 * GET /api/reports/exam/:examId
 * Professor sees summary for all sessions in an exam.
 */
router.get(
  '/exam/:examId',
  requireAuth,
  requireRole('PROFESSOR'),
  async (req: AuthRequest, res: Response) => {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.examId } });
    if (!exam || exam.ownerId !== req.user!.id) {
      res.status(404).json({ error: 'Exam not found' });
      return;
    }

    const sessions = await prisma.session.findMany({
      where: { examId: req.params.examId },
      include: {
        user: { select: { name: true, email: true } },
        _count: { select: { events: true, flags: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ examId: req.params.examId, sessions });
  }
);

export default router;

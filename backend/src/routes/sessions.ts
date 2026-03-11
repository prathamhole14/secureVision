import { Router, Response } from 'express';
import { prisma } from '../utils/prismaClient';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/sessions/:id — get session details
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
    include: {
      exam: { select: { title: true, duration: true } },
      user: { select: { name: true, email: true } },
      _count: { select: { events: true, flags: true } },
    },
  });
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  // Only owner or professor of exam can view
  const exam = await prisma.exam.findUnique({ where: { id: session.examId } });
  if (session.userId !== req.user!.id && exam?.ownerId !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  res.json({ session });
});

// PATCH /api/sessions/:id/status — update status (server or professor)
router.patch('/:id/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  const validStatuses = ['ACTIVE', 'COMPLETED', 'TERMINATED', 'FLAGGED'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }
  const session = await prisma.session.findUnique({ where: { id: req.params.id } });
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const updated = await prisma.session.update({
    where: { id: req.params.id },
    data: {
      status,
      startedAt: status === 'ACTIVE' && !session.startedAt ? new Date() : session.startedAt,
      endedAt: ['COMPLETED', 'TERMINATED'].includes(status) ? new Date() : session.endedAt,
    },
  });
  res.json({ session: updated });
});

export default router;

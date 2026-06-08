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
  const { status, answers } = req.body;
  const validStatuses = ['ACTIVE', 'COMPLETED', 'TERMINATED', 'FLAGGED'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }
  const session = await prisma.session.findUnique({ 
    where: { id: req.params.id },
    include: { exam: true }
  });
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // Handle auto-grading if answers are provided on completion
  if (status === 'COMPLETED' && answers && session.exam?.configJson) {
    let config: any = {};
    try {
      config = typeof session.exam.configJson === 'string' 
        ? JSON.parse(session.exam.configJson) 
        : session.exam.configJson;
    } catch (e) { console.error('Error parsing config for auto-grading'); }

    const questions = config.questions || [];
    let score = 0;
    let maxPoints = config.totalPoints || 0;

    questions.forEach((q: any) => {
      const p = parseInt(q.points) || 0;
      if (answers[q.id] !== undefined) {
        if (q.type === 'multiple_choice' && answers[q.id] === q.answer) {
          score += p;
        } else if (q.type === 'short_answer') {
          // Rudimentary short-answer auto grade: case-insensitive match if answer key provided
          if (q.answer && String(answers[q.id]).toLowerCase().trim() === String(q.answer).toLowerCase().trim()) {
            score += p;
          }
        }
      }
    });

    // Save the submission details as a telemetry event
    await prisma.event.create({
      data: {
        sessionId: session.id,
        timestamp: new Date(),
        type: 'exam_submitted',
        payloadJson: JSON.stringify({ answers, score, maxPoints }),
        severity: 'LOW',
      }
    });
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

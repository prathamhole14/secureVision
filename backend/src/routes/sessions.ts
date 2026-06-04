import { Router, Response, Request } from 'express';
import { prisma } from '../utils/prismaClient';
import { requireAuth, AuthRequest } from '../middleware/auth';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { getSocketIO } from '../socket/server';

const router = Router();

// Helper to generate a unique random entry code
function generateRandomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // exclude confusing chars like 0, O, 1, I
  let code = 'SV-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// GET /api/sessions/my-sessions — list all past sessions and scores of logged-in student
router.get('/my-sessions', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const sessions = await prisma.session.findMany({
      where: { userId: req.user!.id },
      include: {
        exam: {
          select: {
            title: true,
            duration: true,
          },
        },
        events: {
          where: { type: 'exam_submitted' },
          take: 1,
        },
        _count: {
          select: { flags: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mapped = sessions.map((s) => {
      let score: number | undefined;
      let maxPoints: number | undefined;

      if (s.events.length > 0) {
        try {
          const payload = JSON.parse(s.events[0].payloadJson);
          score = payload.score;
          maxPoints = payload.maxPoints;
        } catch {}
      }

      return {
        id: s.id,
        examTitle: s.exam.title,
        duration: s.exam.duration,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        status: s.status,
        flagCount: s._count.flags,
        score,
        maxPoints,
      };
    });

    res.json({ sessions: mapped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching past sessions' });
  }
});

// POST /api/sessions/generate-code — generate unique exam code for a student
router.post('/generate-code', requireAuth, async (req: AuthRequest, res: Response) => {
  const { examId, classroomId } = req.body;
  if (!examId) {
    res.status(400).json({ error: 'examId is required' });
    return;
  }

  try {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || !exam.isActive) {
      res.status(404).json({ error: 'Exam not found or is inactive' });
      return;
    }

    const existing = await prisma.session.findFirst({
      where: {
        examId,
        userId: req.user!.id,
      },
    });

    if (existing) {
      if (existing.status === 'COMPLETED' || existing.status === 'TERMINATED') {
        res.status(400).json({ error: 'You have already submitted this exam' });
        return;
      }
      if (existing.entryCode) {
        res.json({
          entryCode: existing.entryCode,
          sessionId: existing.id,
          sessionToken: existing.sessionToken,
        });
        return;
      }
    }

    let entryCode = generateRandomCode();
    let attempts = 0;
    while (attempts < 10) {
      const dupe = await prisma.session.findUnique({ where: { entryCode } });
      if (!dupe) break;
      entryCode = generateRandomCode();
      attempts++;
    }

    const session = await prisma.session.create({
      data: {
        examId,
        userId: req.user!.id,
        sessionToken: uuidv4(),
        entryCode,
        status: 'PENDING',
        classroomId: classroomId ? String(classroomId) : undefined,
      },
    });

    res.status(201).json({
      entryCode: session.entryCode,
      sessionId: session.id,
      sessionToken: session.sessionToken,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generating entry code' });
  }
});

// POST /api/sessions/validate-code — validate access code entered in Electron client
router.post('/validate-code', async (req: Request, res: Response) => {
  const { entryCode } = req.body;
  if (!entryCode) {
    res.status(400).json({ error: 'entryCode is required' });
    return;
  }

  try {
    const session = await prisma.session.findUnique({
      where: { entryCode: String(entryCode).toUpperCase().trim() },
      include: {
        user: true,
        exam: true,
      },
    });

    if (!session) {
      res.status(404).json({ error: 'Invalid access code' });
      return;
    }

    if (session.status === 'COMPLETED' || session.status === 'TERMINATED') {
      res.status(400).json({ error: 'This exam session has already been submitted or terminated' });
      return;
    }

    const token = jwt.sign(
      { id: session.user.id, email: session.user.email, role: session.user.role },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    );

    let config: any = {};
    if (typeof session.exam.configJson === 'string') {
      try { config = JSON.parse(session.exam.configJson); } catch {}
    } else {
      config = session.exam.configJson || {};
    }
    
    const safeConfig = {
      ...config,
      questions: (config.questions || []).map((q: any) => {
        const { answer, ...safeQ } = q;
        return safeQ;
      }),
    };

    res.json({
      token,
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
      },
      sessionId: session.id,
      sessionToken: session.sessionToken,
      duration: session.exam.duration,
      examConfig: safeConfig,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error validating access code' });
  }
});

// GET /api/sessions/:id — get session details
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
    include: {
      exam: true,
      user: { select: { name: true, email: true } },
      events: {
        where: { type: 'exam_submitted' },
        take: 1,
      },
      _count: { select: { events: true, flags: true } },
    },
  });
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (session.userId !== req.user!.id && session.exam.ownerId !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  res.json({ session });
});

// POST /api/sessions/:id/penalize — professor manually adjusts student score or disqualifies them
router.post('/:id/penalize', requireAuth, async (req: AuthRequest, res: Response) => {
  const { penalty } = req.body; // e.g. -1 or 'DISQUALIFY'
  
  try {
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      include: { exam: true }
    });
    
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    
    if (session.exam.ownerId !== req.user!.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    
    // Find the exam_submitted event
    const event = await prisma.event.findFirst({
      where: { sessionId: session.id, type: 'exam_submitted' },
      orderBy: { createdAt: 'desc' }
    });
    
    if (!event) {
      res.status(400).json({ error: 'Submission not found or student has not submitted yet' });
      return;
    }
    
    const payload = JSON.parse(event.payloadJson);
    let newScore = payload.score;
    
    if (penalty === 'DISQUALIFY') {
      newScore = 0;
    } else {
      newScore = Math.max(0, newScore + Number(penalty));
    }
    
    await prisma.event.update({
      where: { id: event.id },
      data: {
        payloadJson: JSON.stringify({
          ...payload,
          score: newScore,
          isPenalized: true,
          originalScore: payload.originalScore || payload.score,
          penaltyReason: penalty === 'DISQUALIFY' ? 'Disqualification' : `Mark deduction (${penalty})`
        })
      }
    });
    
    res.json({ success: true, newScore });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error penalizing session' });
  }
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

  let calculatedScore: number | undefined;
  let calculatedMaxPoints: number | undefined;

  if (status === 'COMPLETED' && session.exam?.configJson) {
    const finalAnswers = answers || {};
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
      if (finalAnswers[q.id] !== undefined) {
        if (q.type === 'multiple_choice' && finalAnswers[q.id] === q.answer) {
          score += p;
        } else if (q.type === 'short_answer') {
          if (q.answer && String(finalAnswers[q.id]).toLowerCase().trim() === String(q.answer).toLowerCase().trim()) {
            score += p;
          }
        }
      }
    });

    calculatedScore = score;
    calculatedMaxPoints = maxPoints;

    await prisma.event.create({
      data: {
        sessionId: session.id,
        timestamp: new Date(),
        type: 'exam_submitted',
        payloadJson: JSON.stringify({ answers: finalAnswers, score, maxPoints }),
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

  // Notify professor dashboard via Socket.IO
  const io = getSocketIO();
  if (io) {
    const eventType = status === 'COMPLETED' ? 'exam_submitted' : 'session_terminated';
    const payload = calculatedScore !== undefined ? { score: calculatedScore, maxPoints: calculatedMaxPoints } : undefined;
    io.to(`professor:${session.examId}`).emit('telemetry:event', {
      sessionId: session.id,
      studentId: session.userId,
      event: {
        type: eventType,
        severity: 'LOW',
        timestamp: new Date().toISOString(),
        payload,
      },
      receivedAt: new Date(),
    });
  }

  res.json({ session: updated });
});

export default router;

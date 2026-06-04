import { Router, Response } from 'express';
import { prisma } from '../utils/prismaClient';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getSocketIO } from '../socket/server';
import { detectionEngine } from '../services/detectionEngine';
import { z } from 'zod';

const router = Router();

const TelemetryEventSchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
  type: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('LOW'),
});

const BatchSchema = z.object({
  sessionId: z.string().uuid(),
  events: z.array(TelemetryEventSchema).max(500),
});

/**
 * POST /api/telemetry/batch
 * Student client calls this to upload a batch of telemetry events.
 */
router.post('/batch', requireAuth, async (req: AuthRequest, res: Response) => {
  const body = BatchSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() });
    return;
  }

  const session = await prisma.session.findUnique({
    where: { id: body.data.sessionId },
  });
  if (!session || session.userId !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const events = await prisma.event.createMany({
    data: body.data.events.map((e) => ({
      sessionId: body.data.sessionId,
      timestamp: new Date(e.timestamp),
      type: e.type,
      payloadJson: JSON.stringify(e.payload),
      severity: e.severity,
    })),
  });

  // Run detection engine on new events async (don't block response)
  detectionEngine
    .processBatch(body.data.sessionId, body.data.events)
    .catch(console.error);

  // Notify professor dashboard via Socket.IO
  const io = getSocketIO();
  if (io) {
    io.to(`professor:${session.examId}`).emit('telemetry:batch', {
      sessionId: body.data.sessionId,
      events: body.data.events,
    });
  }

  res.status(202).json({ accepted: events.count });
});

export default router;

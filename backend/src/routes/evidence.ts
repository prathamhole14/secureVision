import { Router, Response, Request } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/evidence
 * Stub endpoint for uploading snapshots or video clips.
 * In production, this would stream to S3 and store metadata.
 */
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { sessionId, type, filename } = req.body;
  if (!sessionId || !type) {
    res.status(400).json({ error: 'sessionId and type are required' });
    return;
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // TODO: In production, upload req.body.data (base64 or stream) to S3
  const fakePath = `s3://anticheat-evidence/${sessionId}/${Date.now()}_${filename || 'snapshot.jpg'}`;

  const artifact = await prisma.artifact.create({
    data: {
      sessionId,
      type: type || 'snapshot',
      s3Path: fakePath,
    },
  });

  logger.info(`Evidence stored: ${fakePath}`);
  res.status(201).json({ artifact });
});

export default router;

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';

let io: Server | null = null;

export function initSocketIO(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: (process.env.ALLOWED_ORIGINS || '').split(','),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/ws',
  });

  // Auth middleware for Socket.IO
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string;
    if (!token) {
      next(new Error('Authentication error: No token provided'));
      return;
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        id: string;
        role: string;
        email: string;
      };
      (socket as Socket & { user: typeof decoded }).user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // ——— Exam namespace /exam ———
  const examNs = io.of('/exam');
  examNs.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string;
    if (!token) return next(new Error('No token'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!);
      (socket as any).user = decoded;
      next();
    } catch (e) {
      next(new Error('Invalid token'));
    }
  });

  examNs.on('connection', async (socket: Socket) => {
    const user = (socket as any).user;
    logger.info(`[Socket.IO] User connected: ${user.email} (${user.role})`);

    // Student joins their exam session room
    socket.on('student:join', async ({ sessionId }: { sessionId: string }) => {
      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!session || session.userId !== user.id) {
        socket.emit('error', { message: 'Invalid sessionId' });
        return;
      }

      await prisma.session.update({
        where: { id: sessionId },
        data: { status: 'ACTIVE', startedAt: new Date() },
      });

      socket.join(`session:${sessionId}`);
      socket.join(`exam:${session.examId}`); // so professor commands reach student
      logger.info(`Student ${user.email} joined session ${sessionId}`);
      socket.emit('session:started', { sessionId, startedAt: new Date() });

      // Notify professor dashboard
      examNs.to(`professor:${session.examId}`).emit('student:entered', {
        sessionId,
        studentId: user.id,
        studentEmail: user.email,
        joinedAt: new Date(),
      });
    });

    // Professor joins the monitoring room for an exam
    socket.on('professor:monitor', async ({ examId }: { examId: string }) => {
      if (user.role !== 'PROFESSOR') {
        socket.emit('error', { message: 'Forbidden' });
        return;
      }
      socket.join(`professor:${examId}`);
      logger.info(`Professor ${user.email} monitoring exam ${examId}`);

      // Send list of currently active sessions
      const activeSessions = await prisma.session.findMany({
        where: { examId, status: 'ACTIVE' },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      socket.emit('monitor:init', { activeSessions });
    });

    // Professor sends a command to a specific student's session
    socket.on(
      'professor:command',
      ({ sessionId, command }: { sessionId: string; command: string }) => {
        if (user.role !== 'PROFESSOR') {
          socket.emit('error', { message: 'Forbidden' });
          return;
        }
        examNs.to(`session:${sessionId}`).emit('server:command', {
          command,
          issuedAt: new Date(),
          issuedBy: user.email,
        });
        logger.info(`Professor issued "${command}" to session ${sessionId}`);
      }
    );

    // Real-time single telemetry event from client (low-latency path)
    socket.on('student:telemetry', async (event: {
      sessionId: string;
      type: string;
      payload: Record<string, unknown>;
      severity: string;
    }) => {
      const session = await prisma.session.findUnique({ where: { id: event.sessionId } });
      if (!session || session.userId !== user.id) return;

      await prisma.event.create({
        data: {
          sessionId: event.sessionId,
          timestamp: new Date(),
          type: event.type,
          payloadJson: JSON.stringify(event.payload),
          severity: (event.severity as 'LOW' | 'MEDIUM' | 'HIGH') || 'LOW',
        },
      });

      examNs.to(`professor:${session.examId}`).emit('telemetry:event', {
        sessionId: event.sessionId,
        studentId: user.id,
        event,
        receivedAt: new Date(),
      });
    });

    socket.on('disconnect', () => {
      logger.info(`[Socket.IO] Disconnected: ${user.email}`);
    });
  });

  logger.info('Socket.IO initialized on /ws path, /exam namespace');
  return io;
}

export function getSocketIO(): Server | null {
  return io;
}

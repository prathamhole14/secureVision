import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { initSocketIO } from './socket/server';
import { requestLogger } from './middleware/requestLogger';
import authRoutes from './routes/auth';
import examRoutes from './routes/exams';
import sessionRoutes from './routes/sessions';
import telemetryRoutes from './routes/telemetry';
import reportRoutes from './routes/reports';
import evidenceRoutes from './routes/evidence';
import classroomRoutes from './routes/classrooms';
import { logger } from './utils/logger';

const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO
initSocketIO(httpServer);

// Parse allowed origins — always include Electron (file://) and common dev ports
const rawOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
const allowedOrigins = [
  ...rawOrigins,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
];

// Core Middleware
app.use(
  helmet({
    // Allow Electron / cross-origin clients to load backend resources (e.g. socket.io.js)
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false, // CSP is handled by the Electron renderer
  })
);
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (Electron, curl, mobile apps)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Allow any localhost port in development
      if (process.env.NODE_ENV !== 'production' && origin.startsWith('http://localhost')) {
        return callback(null, true);
      }
      callback(new Error(`CORS policy: origin ${origin} is not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(requestLogger);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/evidence', evidenceRoutes);
app.use('/api/classrooms', classroomRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Global Error Handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  }
);

const PORT = parseInt(process.env.PORT || '3001', 10);
httpServer.listen(PORT, () => {
  logger.info(`🔒 secureVision Backend running at http://localhost:${PORT}`);
});

export default app;

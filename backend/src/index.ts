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
import { logger } from './utils/logger';

const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO
initSocketIO(httpServer);

// Core Middleware
app.use(helmet());
app.use(
  cors({
    origin: (process.env.ALLOWED_ORIGINS || '').split(','),
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
  logger.info(`🚀 AntiCheat Backend running at http://localhost:${PORT}`);
});

export default app;

import { prisma } from '../utils/prismaClient';
import { getSocketIO } from '../socket/server';
import { logger } from '../utils/logger';

interface TelemetryEvent {
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
  severity?: string;
}

// Rule definitions
const RULES: Array<{
  id: string;
  name: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: number;
  match: (event: TelemetryEvent) => boolean;
}> = [
  {
    id: 'SCREEN_CAPTURE_ATTEMPT',
    name: 'Screen capture attempt detected',
    severity: 'HIGH',
    confidence: 0.95,
    match: (e) => e.type === 'screen_capture_attempt',
  },
  {
    id: 'REMOTE_SESSION_DETECTED',
    name: 'Remote desktop / RDP session detected',
    severity: 'HIGH',
    confidence: 0.9,
    match: (e) => e.type === 'remote_session_detected',
  },
  {
    id: 'BLACKLISTED_PROCESS',
    name: 'Blacklisted process running during exam',
    severity: 'MEDIUM',
    confidence: 0.85,
    match: (e) => {
      if (e.type !== 'process_detected') return false;
      const proc = String((e.payload as Record<string, unknown>).process || '').toLowerCase();
      const cleanProc = proc.trim().replace(/\.exe$/, '');
      return BLACKLISTED_PROCESSES.some((bl) => {
        return cleanProc === bl || cleanProc.includes(`/${bl}`) || cleanProc.includes(`\\${bl}`) || cleanProc.includes(bl);
      });
    },
  },
  {
    id: 'FOCUS_LOSS',
    name: 'Window focus lost (tab change or alt-tab)',
    severity: 'LOW',
    confidence: 0.7,
    match: (e) => e.type === 'focus_loss',
  },
  {
    id: 'MULTI_MONITOR',
    name: 'Multiple monitors detected',
    severity: 'MEDIUM',
    confidence: 0.8,
    match: (e) => e.type === 'multi_monitor_detected',
  },
  {
    id: 'CLIPBOARD_ACCESS',
    name: 'Clipboard access attempt detected',
    severity: 'LOW',
    confidence: 0.6,
    match: (e) => e.type === 'clipboard_access',
  },
  {
    id: 'DAEMON_TAMPER',
    name: 'Security daemon tamper detected',
    severity: 'HIGH',
    confidence: 1.0,
    match: (e) => e.type === 'daemon_tamper',
  },
];

const BLACKLISTED_PROCESSES = [
  'anydesk',
  'teamviewer',
  'obs',
  'obs64',
  'obs32',
  'vnc',
  'xsplit',
  'screencast-o-matic',
  'camtasia',
  'screenpresso',
  'sharex',
  'lightshot',
  'fraps',
  'bandicam',
  'discord',
  'zoom',
  'skype',
  'slack',
  'telegram',
  'whatsapp',
];

class DetectionEngine {
  async processBatch(sessionId: string, events: TelemetryEvent[]) {
    for (const event of events) {
      for (const rule of RULES) {
        if (rule.match(event)) {
          await this.createFlag(sessionId, rule, event);
        }
      }
    }
  }

  private async createFlag(
    sessionId: string,
    rule: (typeof RULES)[number],
    event: TelemetryEvent
  ) {
    let notes = rule.name;
    if (rule.id === 'BLACKLISTED_PROCESS' && event.payload?.process) {
      notes = `Blacklisted process: ${event.payload.process}`;
    }

    // Deduplication check: prevent triplicated identical flags within 3 seconds of each other
    // For BLACKLISTED_PROCESS, we deduplicate per specific process name (in the notes field)
    const recentFlag = await prisma.flag.findFirst({
      where: {
        sessionId,
        ruleId: rule.id,
        notes: rule.id === 'BLACKLISTED_PROCESS' ? notes : undefined,
        createdAt: {
          gte: new Date(Date.now() - 3000), // last 3 seconds
        },
      },
    });
    if (recentFlag) {
      logger.info(`🚩 [Deduplication] Prevented duplicate flag [${rule.id}] - ${notes} for session ${sessionId}`);
      return;
    }

    // Find event record
    const dbEvent = await prisma.event.findFirst({
      where: { sessionId, type: event.type },
      orderBy: { createdAt: 'desc' },
    });

    const flag = await prisma.flag.create({
      data: {
        sessionId,
        eventId: dbEvent?.id,
        ruleId: rule.id,
        confidence: rule.confidence,
        severity: rule.severity,
        notes: notes,
      },
    });

    logger.warn(
      `🚩 FLAG [${rule.severity}] session=${sessionId} rule=${rule.id} conf=${rule.confidence} - ${notes}`
    );

    // Get examId for broadcasting to professor
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return;

    const io = getSocketIO();
    if (io) {
      io.of('/exam')
        .to(`professor:${session.examId}`)
        .emit('session:flag', {
          sessionId,
          flag: {
            ruleId: rule.id,
            severity: rule.severity,
            confidence: rule.confidence,
            name: notes,
            eventType: event.type,
            timestamp: event.timestamp,
          },
        });
    }

    return flag;
  }
}

export const detectionEngine = new DetectionEngine();

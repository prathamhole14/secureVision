import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import api from '../lib/api';

interface StudentEntry {
  sessionId: string;
  studentId: string;
  studentEmail: string;
  joinedAt: string;
  status: 'active' | 'flagged' | 'warning' | 'completed' | 'terminated';
  recentEvents: Array<{ type: string; severity: string; ts: string }>;
  flagCount: number;
  platform?: string;
  score?: number;
  maxPoints?: number;
}

interface Flag {
  ruleId: string;
  severity: string;
  name: string;
  sessionId: string;
  timestamp: string;
}

function TimeElapsed({ joinedAt }: { joinedAt: string }) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const update = () => {
      const diff = Math.floor((Date.now() - new Date(joinedAt).getTime()) / 1000);
      const m = Math.floor(diff / 60);
      const s = String(diff % 60).padStart(2, '0');
      setElapsed(`${m}:${s}`);
    };
    update();
    const int = setInterval(update, 1000);
    return () => clearInterval(int);
  }, [joinedAt]);

  return <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{elapsed}</span>;
}

export default function MonitorPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const [students, setStudents] = useState<Record<string, StudentEntry>>({});
  const [flags, setFlags] = useState<Flag[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const socket = io('/exam', {
      path: '/ws',
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('professor:monitor', { examId });
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('monitor:init', ({ activeSessions }: { activeSessions: Array<any> }) => {
      const initial: Record<string, StudentEntry> = {};
      const newFlags: Flag[] = [];

      activeSessions.forEach((s) => {
        let derivedStatus = s.status ? s.status.toLowerCase() : 'active';
        let flagCount = s.flags ? s.flags.length : 0;
        let platform: string | undefined;
        let score: number | undefined;
        let maxPoints: number | undefined;

        if (s.flags && s.flags.length > 0) {
          s.flags.forEach((f: any) => newFlags.push({ ...f, sessionId: s.id }));
        }

        const recentEvents = (s.events || []).map((e: any) => {
          if (e.type === 'daemon_heartbeat' && e.payloadJson && !platform) {
            try { const p = JSON.parse(e.payloadJson); platform = p.platform; } catch {}
          }
          if (e.type === 'exam_submitted' && e.payloadJson) {
            try { const p = JSON.parse(e.payloadJson); score = p.score; maxPoints = p.maxPoints; } catch {}
            derivedStatus = 'completed';
          }
          return { type: e.type, severity: e.severity, ts: e.timestamp };
        });

        if (derivedStatus === 'active') {
          const hasHigh = (s.events || []).some((e: any) => e.severity === 'HIGH');
          const hasMed = (s.events || []).some((e: any) => e.severity === 'MEDIUM');
          if (hasHigh) derivedStatus = 'flagged';
          else if (hasMed) derivedStatus = 'warning';
        }

        initial[s.id] = {
          sessionId: s.id,
          studentId: s.user.id,
          studentEmail: s.user.email,
          joinedAt: s.startedAt || new Date().toISOString(),
          status: derivedStatus as any,
          recentEvents: recentEvents.slice(0, 5),
          flagCount,
          platform,
          score,
          maxPoints,
        };
      });

      setStudents(initial);
      if (newFlags.length > 0) {
        setFlags((prev) => {
          const map = new Map();
          [...prev, ...newFlags].forEach((f) => map.set(f.sessionId + f.timestamp, f));
          return Array.from(map.values()).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        });
      }
    });

    socket.on('student:entered', (data: { sessionId: string; studentId: string; studentEmail: string }) => {
      setStudents((prev) => ({
        ...prev,
        [data.sessionId]: {
          ...data,
          joinedAt: new Date().toISOString(),
          status: 'active',
          recentEvents: [],
          flagCount: 0,
        },
      }));
    });

    socket.on('telemetry:event', ({ sessionId, event }: { sessionId: string; event: { type: string; severity: string; timestamp: string, payload?: any } }) => {
      setStudents((prev) => {
        const s = prev[sessionId];
        if (!s) return prev;
        let newStatus = s.status;
        if (s.status === 'active' || s.status === 'warning') {
           if (event.severity === 'HIGH') newStatus = 'flagged';
           else if (event.severity === 'MEDIUM' && (s.status as string) !== 'flagged') newStatus = 'warning';
        }
        
        let platform = s.platform;
        let score = s.score;
        let maxPoints = s.maxPoints;

        if (event.type === 'daemon_heartbeat' && event.payload?.platform) platform = event.payload.platform;
        if (event.type === 'exam_submitted') {
           newStatus = 'completed';
           if (event.payload) { score = event.payload.score; maxPoints = event.payload.maxPoints; }
        }

        return {
          ...prev,
          [sessionId]: {
            ...s,
            status: newStatus,
            platform,
            score,
            maxPoints,
            recentEvents: [{ type: event.type, severity: event.severity, ts: event.timestamp }, ...s.recentEvents].slice(0, 5),
          },
        };
      });
    });

    socket.on('telemetry:batch', ({ sessionId, events }: { sessionId: string; events: Array<{ type: string; severity: string; timestamp: string, payload?: any }> }) => {
      setStudents((prev) => {
        const s = prev[sessionId];
        if (!s) return prev;
        let newStatus = s.status;
        
        if (s.status === 'active' || s.status === 'warning') {
           const highSev = events.find((e) => e.severity === 'HIGH');
           const medSev = events.find((e) => e.severity === 'MEDIUM');
           if (highSev) newStatus = 'flagged';
           else if (medSev && (s.status as string) !== 'flagged') newStatus = 'warning';
        }

        let platform = s.platform;
        let score = s.score;
        let maxPoints = s.maxPoints;

        const heartbeat = events.find((e) => e.type === 'daemon_heartbeat' && e.payload?.platform);
        if (heartbeat) platform = heartbeat.payload.platform;

        const submitted = events.find((e) => e.type === 'exam_submitted');
        if (submitted) {
           newStatus = 'completed';
           if (submitted.payload) { score = submitted.payload.score; maxPoints = submitted.payload.maxPoints; }
        }

        return {
          ...prev,
          [sessionId]: {
            ...s,
            status: newStatus,
            platform,
            score,
            maxPoints,
            recentEvents: [...events.slice(-3).reverse().map((e) => ({ type: e.type, severity: e.severity, ts: e.timestamp })), ...s.recentEvents].slice(0, 5),
          },
        };
      });
    });

    socket.on('session:flag', ({ sessionId, flag }: { sessionId: string; flag: Flag }) => {
      setFlags((prev) => [{ ...flag, sessionId, timestamp: flag.timestamp || new Date().toISOString() }, ...prev]);
      setStudents((prev) => {
        const s = prev[sessionId];
        if (!s) return prev;
        return { ...prev, [sessionId]: { ...s, flagCount: s.flagCount + 1, status: s.status === 'completed' ? 'completed' : flag.severity === 'HIGH' ? 'flagged' : 'warning' } };
      });
    });

    return () => { socket.disconnect(); };
  }, [examId]);

  function sendCommand(sessionId: string, command: string) {
    socketRef.current?.emit('professor:command', { sessionId, command });
  }

  const studentList = Object.values(students);

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <p className="page-subtitle">Real-time proctoring</p>
          <h1 className="page-title">Live Monitor</h1>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className={`badge ${connected ? 'badge-green' : 'badge-red'}`}>
            {connected ? '● Connected' : '○ Disconnected'}
          </span>
          <button className="btn btn-outline btn-sm" onClick={() => navigate(-1)}>← Back</button>
        </div>
      </div>
      <div className="page-body">

        {/* Recent Flags Feed */}
        {flags.length > 0 && (
          <div className="card" style={{ marginBottom: 24, borderColor: 'var(--red-bg)' }}>
            <div className="card-title" style={{ color: 'var(--red)' }}>🚨 Flag Feed</div>
            {flags.slice(0, 5).map((f, i) => {
              const student = students[f.sessionId];
              const namePos = student ? student.studentEmail.split('@')[0] : 'Unknown';
              return (
                <div key={i} className={`alert alert-${f.severity.toLowerCase()}`} style={{ marginBottom: 8 }}>
                  <strong>[{f.severity}]</strong> {f.name} — <b>{namePos}</b> (session <code style={{ fontSize: '0.75rem' }}>{f.sessionId.slice(0, 8)}…</code>)
                </div>
              );
            })}
          </div>
        )}

        {/* Stats */}
        <div className="stat-grid" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-value">{studentList.length}</div>
            <div className="stat-label">Students Online</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--red)' }}>{studentList.filter((s) => s.status === 'flagged').length}</div>
            <div className="stat-label">Flagged Students</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--yellow)' }}>{studentList.filter((s) => s.status === 'warning').length}</div>
            <div className="stat-label">Warnings</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--green)' }}>{flags.length}</div>
            <div className="stat-label">Total Flags</div>
          </div>
        </div>

        {/* Student Grid */}
        {studentList.length === 0 ? (
          <div className="card empty-state">
            <div className="empty-icon">⏳</div>
            <p>Waiting for students to join…</p>
          </div>
        ) : (
          <div className="monitor-grid">
            {studentList.map((s) => (
              <div key={s.sessionId} className={`student-card ${s.status}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <div className="student-name">{s.studentEmail.split('@')[0]}</div>
                    <div className="student-email">{s.studentEmail}</div>
                  </div>
                  <span className={`badge ${s.status === 'flagged' ? 'badge-red' : s.status === 'warning' ? 'badge-yellow' : 'badge-green'}`}>
                    {s.status === 'flagged' ? '🚨 FLAGGED' : s.status === 'warning' ? '⚠️ WARN' : '✓ OK'}
                  </span>
                </div>

                {/* Extra Session Info */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>⏱️</span> Elapsed: {s.status === 'completed' || s.status === 'terminated' ? 'Finished' : <TimeElapsed joinedAt={s.joinedAt} />}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>💻</span> OS: {s.platform ? <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{s.platform}</span> : <i>Detecting...</i>}
                  </div>
                  {s.score !== undefined && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--green)', fontWeight: 600 }}>
                      <span>📝</span> Score: {s.score} / {s.maxPoints || '?'}
                    </div>
                  )}
                </div>

                {/* Recent Flags */}
                {(() => {
                  const studentFlags = flags.filter(f => f.sessionId === s.sessionId);
                  if (studentFlags.length > 0) {
                    return (
                      <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Breached Rules Info
                        </div>
                        {studentFlags.map((f, i) => (
                          <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text)', background: 'var(--red-bg)', padding: '4px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>🚩</span> {f.name}
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return null;
                })()}

                <div className="event-feed">
                  {s.recentEvents.length === 0 ? (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No events yet</span>
                  ) : (
                    s.recentEvents.map((ev, i) => (
                      <div key={i} className="event-item">
                        <span className={`event-type ${ev.severity}`}>[{ev.severity}]</span>
                        <span>{ev.type}</span>
                      </div>
                    ))
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6, marginTop: 12, flexDirection: 'column' }}>
                  <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={() => navigate(`/reports/${s.sessionId}`)}>
                    📄 View Full Report
                  </button>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={() => sendCommand(s.sessionId, 'FORCE_SUBMIT')}>
                      Force Submit
                    </button>
                    <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => sendCommand(s.sessionId, 'WARN')}>
                      Warn
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

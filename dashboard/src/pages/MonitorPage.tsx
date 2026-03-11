import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import api from '../lib/api';

interface StudentEntry {
  sessionId: string;
  studentId: string;
  studentEmail: string;
  joinedAt: string;
  status: 'active' | 'flagged' | 'warning';
  recentEvents: Array<{ type: string; severity: string; ts: string }>;
  flagCount: number;
}

interface Flag {
  ruleId: string;
  severity: string;
  name: string;
  sessionId: string;
  timestamp: string;
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

    socket.on('monitor:init', ({ activeSessions }: { activeSessions: Array<{ id: string; user: { id: string; email: string; name: string } }> }) => {
      const initial: Record<string, StudentEntry> = {};
      activeSessions.forEach((s) => {
        initial[s.id] = {
          sessionId: s.id,
          studentId: s.user.id,
          studentEmail: s.user.email,
          joinedAt: new Date().toISOString(),
          status: 'active',
          recentEvents: [],
          flagCount: 0,
        };
      });
      setStudents(initial);
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

    socket.on('telemetry:event', ({ sessionId, event }: { sessionId: string; event: { type: string; severity: string; timestamp: string } }) => {
      setStudents((prev) => {
        const s = prev[sessionId];
        if (!s) return prev;
        const newStatus = event.severity === 'HIGH' ? 'flagged' : event.severity === 'MEDIUM' ? 'warning' : s.status;
        return {
          ...prev,
          [sessionId]: {
            ...s,
            status: newStatus,
            recentEvents: [{ type: event.type, severity: event.severity, ts: event.timestamp }, ...s.recentEvents].slice(0, 5),
          },
        };
      });
    });

    socket.on('telemetry:batch', ({ sessionId, events }: { sessionId: string; events: Array<{ type: string; severity: string; timestamp: string }> }) => {
      setStudents((prev) => {
        const s = prev[sessionId];
        if (!s) return prev;
        const highSev = events.find((e) => e.severity === 'HIGH');
        const medSev = events.find((e) => e.severity === 'MEDIUM');
        return {
          ...prev,
          [sessionId]: {
            ...s,
            status: highSev ? 'flagged' : medSev ? 'warning' : s.status,
            recentEvents: [...events.slice(-3).map((e) => ({ type: e.type, severity: e.severity, ts: e.timestamp })), ...s.recentEvents].slice(0, 5),
          },
        };
      });
    });

    socket.on('session:flag', ({ sessionId, flag }: { sessionId: string; flag: Flag }) => {
      setFlags((prev) => [{ ...flag, sessionId, timestamp: flag.timestamp || new Date().toISOString() }, ...prev]);
      setStudents((prev) => {
        const s = prev[sessionId];
        if (!s) return prev;
        return { ...prev, [sessionId]: { ...s, flagCount: s.flagCount + 1, status: flag.severity === 'HIGH' ? 'flagged' : 'warning' } };
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
            {flags.slice(0, 5).map((f, i) => (
              <div key={i} className={`alert alert-${f.severity.toLowerCase()}`} style={{ marginBottom: 8 }}>
                <strong>[{f.severity}]</strong> {f.name} — session <code style={{ fontSize: '0.75rem' }}>{f.sessionId.slice(0, 8)}…</code>
              </div>
            ))}
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

                {s.flagCount > 0 && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--red)', marginBottom: 8 }}>
                    🚩 {s.flagCount} flag{s.flagCount !== 1 ? 's' : ''}
                  </div>
                )}

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

                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => navigate(`/reports/${s.sessionId}`)}>
                    Report
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => sendCommand(s.sessionId, 'FORCE_SUBMIT')}>
                    Force Submit
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => sendCommand(s.sessionId, 'WARN')}>
                    Warn
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

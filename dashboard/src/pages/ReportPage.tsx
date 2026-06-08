import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';

interface SessionReport {
  session: {
    id: string;
    status: string;
    startedAt: string;
    endedAt: string;
    user: { name: string; email: string };
    exam: { title: string };
    events: Array<{ id: string; type: string; severity: string; timestamp: string; payloadJson: object }>;
    flags: Array<{ id: string; ruleId: string; severity: string; confidence: number; notes: string; createdAt: string }>;
  };
  summary: {
    totalEvents: number;
    flagCount: number;
    highSeverityFlags: number;
    mediumSeverityFlags: number;
    artifactCount: number;
  };
}

export default function ReportPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<SessionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'flags' | 'events'>('flags');

  useEffect(() => {
    api.get(`/reports/${sessionId}`).then((r) => setReport(r.data)).finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <div className="login-page"><span className="spinner" /></div>;
  if (!report) return <div className="login-page"><div className="card"><p>Session not found</p></div></div>;

  const { session, summary } = report;

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <p className="page-subtitle">{session.exam.title}</p>
          <h1 className="page-title">Session Report</h1>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => navigate(-1)}>← Back</button>
      </div>
      <div className="page-body">

        {/* Student info */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{session.user.name}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{session.user.email}</div>
            </div>
            <span className={`badge ${session.status === 'COMPLETED' ? 'badge-green' : session.status === 'FLAGGED' ? 'badge-red' : 'badge-blue'}`}>
              {session.status}
            </span>
          </div>
          {session.startedAt && (
            <div style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Started: {new Date(session.startedAt).toLocaleString()}
              {session.endedAt && ` → Ended: ${new Date(session.endedAt).toLocaleString()}`}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-value">{summary.totalEvents}</div>
            <div className="stat-label">Total Events</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--red)' }}>{summary.highSeverityFlags}</div>
            <div className="stat-label">High Severity Flags</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--yellow)' }}>{summary.mediumSeverityFlags}</div>
            <div className="stat-label">Medium Severity Flags</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{summary.artifactCount}</div>
            <div className="stat-label">Artifacts</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['flags', 'events'] as const).map((tab) => (
            <button
              key={tab}
              className={`btn btn-sm ${activeTab === tab ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'flags' ? `🚩 Flags (${summary.flagCount})` : `📋 Events (${summary.totalEvents})`}
            </button>
          ))}
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrapper">
            {activeTab === 'flags' ? (
              session.flags.length === 0 ? (
                <div className="empty-state"><div className="empty-icon">✅</div><p>No flags detected</p></div>
              ) : (
                <table>
                  <thead><tr><th>Rule</th><th>Severity</th><th>Confidence</th><th>Description</th><th>Time</th></tr></thead>
                  <tbody>
                    {session.flags.map((f) => (
                      <tr key={f.id}>
                        <td><code style={{ fontSize: '0.78rem' }}>{f.ruleId}</code></td>
                        <td><span className={`badge ${f.severity === 'HIGH' ? 'badge-red' : f.severity === 'MEDIUM' ? 'badge-yellow' : 'badge-green'}`}>{f.severity}</span></td>
                        <td>{(f.confidence * 100).toFixed(0)}%</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{f.notes}</td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{new Date(f.createdAt).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : (
              session.events.length === 0 ? (
                <div className="empty-state"><div className="empty-icon">📭</div><p>No events recorded</p></div>
              ) : (
                <table>
                  <thead><tr><th>Time</th><th>Type</th><th>Severity</th><th>Payload</th></tr></thead>
                  <tbody>
                    {session.events.map((e) => (
                      <tr key={e.id}>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{new Date(e.timestamp).toLocaleTimeString()}</td>
                        <td style={{ fontWeight: 500 }}>{e.type}</td>
                        <td><span className={`badge ${e.severity === 'HIGH' ? 'badge-red' : e.severity === 'MEDIUM' ? 'badge-yellow' : 'badge-green'}`}>{e.severity}</span></td>
                        <td><code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{JSON.stringify(e.payloadJson).slice(0, 60)}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </div>
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import StudentPortal from './StudentPortal';

interface Exam {
  id: string;
  title: string;
  duration: number;
  isActive: boolean;
  _count: { sessions: number };
}

export default function HomePage() {
  const { user } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // If student role, bypass the entire professor dashboard view
  if (user?.role === 'STUDENT') {
    return <StudentPortal />;
  }

  useEffect(() => {
    api.get('/exams').then((r) => setExams(r.data.exams)).finally(() => setLoading(false));
  }, []);

  const activeExams = exams.filter((e) => e.isActive);
  const totalSessions = exams.reduce((s, e) => s + e._count.sessions, 0);

  return (
    <>
      <div className="page-header">
        <p className="page-subtitle">Welcome back</p>
        <h1 className="page-title">{user?.name ?? 'Professor'} 👋</h1>
      </div>
      <div className="page-body">
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-value">{exams.length}</div>
            <div className="stat-label">Total Exams</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--green)' }}>{activeExams.length}</div>
            <div className="stat-label">Active Exams</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{totalSessions}</div>
            <div className="stat-label">Total Sessions</div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Recent Exams</div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px' }}><span className="spinner" /></div>
          ) : exams.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📝</div>
              <p>No exams yet. <a onClick={() => navigate('/exams')} style={{ cursor: 'pointer' }}>Create your first exam.</a></p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Duration</th>
                    <th>Sessions</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {exams.slice(0, 5).map((exam) => (
                    <tr key={exam.id}>
                      <td style={{ fontWeight: 500 }}>{exam.title}</td>
                      <td>{exam.duration} min</td>
                      <td>{exam._count.sessions}</td>
                      <td>
                        <span className={`badge ${exam.isActive ? 'badge-green' : 'badge-blue'}`}>
                          {exam.isActive ? '● Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        {exam.isActive && (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => navigate(`/monitor/${exam.id}`)}
                          >
                            📡 Monitor
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

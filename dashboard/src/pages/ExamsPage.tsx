import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

interface Exam {
  id: string;
  title: string;
  duration: number;
  isActive: boolean;
  createdAt: string;
  _count: { sessions: number };
}

interface CreateExamForm {
  title: string;
  duration: string;
  lowSeverityAction: string;
  mediumSeverityAction: string;
  highSeverityAction: string;
}

export default function ExamsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const [form, setForm] = useState<CreateExamForm>({
    title: '',
    duration: '90',
    lowSeverityAction: 'warn',
    mediumSeverityAction: 'warn',
    highSeverityAction: 'submit',
  });

  const [classroomsList, setClassroomsList] = useState<any[]>([]);
  const [selectedClassrooms, setSelectedClassrooms] = useState<string[]>([]);

  useEffect(() => {
    fetchExams();
    api.get('/classrooms').then((res) => setClassroomsList(res.data.classrooms || [])).catch(() => {});
  }, []);

  async function fetchExams() {
    setLoading(true);
    const r = await api.get('/exams');
    setExams(r.data.exams);
    setLoading(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/exams', {
        title: form.title,
        duration: parseInt(form.duration),
        classrooms: selectedClassrooms,
        config: {
          questions: [],
          policy: {
            lowSeverityAction: form.lowSeverityAction,
            mediumSeverityAction: form.mediumSeverityAction,
            highSeverityAction: form.highSeverityAction,
          },
          webcamRequired: false,
          totalPoints: 0,
        },
      });
      setShowModal(false);
      setForm({ title: '', duration: '90', lowSeverityAction: 'warn', mediumSeverityAction: 'warn', highSeverityAction: 'submit' });
      setSelectedClassrooms([]);
      fetchExams();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to create exam');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(exam: Exam) {
    await api.patch(`/exams/${exam.id}`, { isActive: !exam.isActive });
    fetchExams();
  }

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <p className="page-subtitle">Manage your examinations</p>
          <h1 className="page-title">Exams</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + New Exam
        </button>
      </div>
      <div className="page-body">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px' }}><span className="spinner" /></div>
        ) : exams.length === 0 ? (
          <div className="card empty-state">
            <div className="empty-icon">📋</div>
            <p>No exams created yet.</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}>
              Create First Exam
            </button>
          </div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
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
                  {exams.map((exam) => (
                    <tr key={exam.id}>
                      <td style={{ fontWeight: 600 }}>{exam.title}</td>
                      <td>{exam.duration} min</td>
                      <td>{exam._count?.sessions ?? 0}</td>
                      <td>
                        <span className={`badge ${exam.isActive ? 'badge-green' : 'badge-blue'}`}>
                          {exam.isActive ? '● Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-outline btn-sm" onClick={() => navigate(`/exams/${exam.id}/questions`)}>
                              📝 Questions
                            </button>
                          {exam.isActive && (
                            <button className="btn btn-outline btn-sm" onClick={() => navigate(`/monitor/${exam.id}`)}>
                              📡 Monitor
                            </button>
                          )}
                          <button
                            className={`btn btn-sm ${exam.isActive ? 'btn-danger' : 'btn-outline'}`}
                            onClick={() => toggleActive(exam)}
                          >
                            {exam.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Create New Exam</span>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>

            {error && <div className="alert alert-high">{error}</div>}

            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">Exam Title</label>
                <input
                  className="form-input"
                  placeholder="e.g. Midterm CS101"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Duration (minutes)</label>
                <input
                  className="form-input"
                  type="number"
                  min="1"
                  value={form.duration}
                  onChange={(e) => setForm({ ...form, duration: e.target.value })}
                  required
                />
              </div>

              <div className="form-group" style={{ marginTop: 16 }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>🏫 Assign to Classes / Batches</label>
                {classroomsList.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0, padding: '4px 0' }}>
                    No classes created yet. You can assign this exam to classes later.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 110, overflowY: 'auto', background: 'rgba(255,255,255,0.01)', padding: 12, borderRadius: 6, border: '1px solid var(--border)' }}>
                    {classroomsList.map((c) => (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer', userSelect: 'none' }}>
                        <input
                          type="checkbox"
                          checked={selectedClassrooms.includes(c.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedClassrooms([...selectedClassrooms, c.id]);
                            } else {
                              setSelectedClassrooms(selectedClassrooms.filter((id) => id !== c.id));
                            }
                          }}
                        />
                        <span>{c.name} <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>({c.code})</span></span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20, marginBottom: 20 }}>
                <div className="card-title" style={{ marginBottom: 16 }}>Anti-Cheat Policy</div>
                {[
                  { key: 'lowSeverityAction', label: '🟡 Low Severity Action', options: ['warn', 'log'] },
                  { key: 'mediumSeverityAction', label: '🟠 Medium Severity Action', options: ['warn'] },
                  { key: 'highSeverityAction', label: '🔴 High Severity Action', options: ['submit', 'lock'] },
                ].map((row) => (
                  <div className="form-group" key={row.key}>
                    <label className="form-label">{row.label}</label>
                    <select
                      className="form-select"
                      value={form[row.key as keyof CreateExamForm]}
                      onChange={(e) => setForm({ ...form, [row.key]: e.target.value })}
                    >
                      {row.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : 'Create Exam'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

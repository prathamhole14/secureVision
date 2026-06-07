import { useEffect, useState } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface Student {
  id: string;
  name: string;
  email?: string;
}

interface Exam {
  id: string;
  title: string;
  duration: number;
  isActive: boolean;
}

interface Classroom {
  id: string;
  name: string;
  code: string;
  teacher: { id: string; name: string; email: string };
  students: Student[];
  exams: Exam[];
}

interface Submission {
  id: string;
  studentName: string;
  studentEmail?: string;
  examId: string;
  examTitle: string;
  status: string;
  startedAt?: string;
  endedAt?: string;
  score?: number;
  maxPoints?: number;
  flags?: Array<{
    id: string;
    ruleId: string;
    severity: string;
    notes?: string;
    createdAt: string;
  }>;
}

function calculateTrustScore(flags: any[]) {
  let score = 100;
  flags.forEach((f) => {
    const sev = String(f.severity).toUpperCase();
    if (sev === 'HIGH') score -= 40;
    else if (sev === 'MEDIUM') score -= 15;
    else if (sev === 'LOW') score -= 5;
  });
  return Math.max(0, score);
}

function getTrustLabel(score: number) {
  if (score >= 90) return { label: 'HIGH TRUST', color: 'var(--green)', bg: 'var(--green-bg)' };
  if (score >= 70) return { label: 'MED SUSPICION', color: 'var(--yellow)', bg: 'var(--yellow-bg)' };
  return { label: 'HIGH SUSPICION', color: 'var(--red)', bg: 'var(--red-bg)' };
}

export default function ClassesPage() {
  const { user } = useAuth();
  const isProfessor = user?.role === 'PROFESSOR';

  const [classrooms, setClassrooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Classrooms selection
  const [selectedClass, setSelectedClass] = useState<Classroom | null>(null);
  const [classSubmissions, setClassSubmissions] = useState<Submission[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>('');

  // Modals & Forms
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Sorting for analytics/rankings
  const [sortBy, setSortBy] = useState<string>('time'); // time, marks-desc, marks-asc, trust-desc, trust-asc

  // Student Access Code Modal
  const [startExamObj, setStartExamObj] = useState<Exam | null>(null);
  const [generatedCode, setGeneratedCode] = useState('');
  const [generatingCode, setGeneratingCode] = useState(false);
  const [copied, setCopied] = useState(false);

  // Student Rankings Modal
  const [rankingExam, setRankingExam] = useState<Exam | null>(null);

  useEffect(() => {
    fetchClassrooms();
  }, []);

  async function fetchClassrooms() {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/classrooms');
      setClassrooms(res.data.classrooms || []);
    } catch (e) {
      setError('Failed to fetch classes.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateClass(e: React.FormEvent) {
    e.preventDefault();
    if (!newClassName.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await api.post('/classrooms', { name: newClassName.trim() });
      setClassrooms([res.data.classroom, ...classrooms]);
      setShowCreateModal(false);
      setNewClassName('');
    } catch (e: any) {
      alert(e.response?.data?.error || 'Failed to create classroom.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleJoinClass(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await api.post('/classrooms/join', { code: joinCode.trim() });
      fetchClassrooms();
      setShowJoinModal(false);
      setJoinCode('');
    } catch (e: any) {
      alert(e.response?.data?.error || 'Failed to join classroom. Verify the code.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectClass(classId: string) {
    setLoading(true);
    try {
      const res = await api.get(`/classrooms/${classId}`);
      setSelectedClass(res.data.classroom);
      setClassSubmissions(res.data.submissions || []);
      const exams = res.data.classroom.exams || [];
      if (exams.length > 0) {
        setSelectedExamId(exams[0].id);
      } else {
        setSelectedExamId('');
      }
    } catch (e) {
      alert('Failed to load class details.');
    } finally {
      setLoading(false);
    }
  }

  // Handle student exam code generation
  async function handleGenerateStudentCode(exam: Exam) {
    setStartExamObj(exam);
    setGeneratedCode('');
    setGeneratingCode(true);
    setCopied(false);
    try {
      const res = await api.post('/sessions/generate-code', { examId: exam.id, classroomId: selectedClass?.id });
      setGeneratedCode(res.data.entryCode);
    } catch (e: any) {
      alert(e.response?.data?.error || 'Could not start exam session.');
      setStartExamObj(null);
    } finally {
      setGeneratingCode(false);
    }
  }

  function handleCopyCode() {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Get dynamic E2E sorted submissions
  const getSortedSubmissions = () => {
    if (!selectedExamId) return [];
    const filtered = classSubmissions.filter((s) => s.examId === selectedExamId);

    return [...filtered].sort((a, b) => {
      if (sortBy === 'time') {
        const timeA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const timeB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        return timeA - timeB; // default asc by attempt time
      }
      if (sortBy === 'marks-desc') {
        return (b.score ?? 0) - (a.score ?? 0);
      }
      if (sortBy === 'marks-asc') {
        return (a.score ?? 0) - (b.score ?? 0);
      }
      if (sortBy === 'trust-desc') {
        const trustA = calculateTrustScore(a.flags || []);
        const trustB = calculateTrustScore(b.flags || []);
        return trustB - trustA;
      }
      if (sortBy === 'trust-asc') {
        const trustA = calculateTrustScore(a.flags || []);
        const trustB = calculateTrustScore(b.flags || []);
        return trustA - trustB;
      }
      return 0;
    });
  };

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <p className="page-subtitle">{isProfessor ? 'Manage classes and view student analytics' : 'Join classes and take assigned exams'}</p>
          <h1 className="page-title">{selectedClass ? `🏫 ${selectedClass.name}` : 'Classrooms'}</h1>
        </div>
        <div>
          {selectedClass ? (
            <button className="btn btn-outline" onClick={() => setSelectedClass(null)}>
              ← Back to List
            </button>
          ) : isProfessor ? (
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              + Create Class / Batch
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => setShowJoinModal(true)}>
              + Join Class with Code
            </button>
          )}
        </div>
      </div>

      <div className="page-body">
        {error && <div className="alert alert-high">{error}</div>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px' }}><span className="spinner" /></div>
        ) : !selectedClass ? (
          /* ==========================================================
             CLASS LIST VIEW (PROFESSOR & STUDENT)
             ========================================================== */
          classrooms.length === 0 ? (
            <div className="card empty-state">
              <div className="empty-icon">🏫</div>
              <p>{isProfessor ? 'No classrooms created yet.' : 'You have not joined any classes yet.'}</p>
              {isProfessor ? (
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowCreateModal(true)}>
                  Create Your First Class
                </button>
              ) : (
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowJoinModal(true)}>
                  Join Your First Class
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {classrooms.map((c) => (
                <div
                  key={c.id}
                  className="card"
                  style={{
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: 180,
                    cursor: 'pointer',
                    background: 'linear-gradient(135deg, #161616 0%, #1c1c1c 100%)',
                    border: '1px solid rgba(255,255,255,0.04)',
                    transition: 'all 0.25s ease'
                  }}
                  onClick={() => handleSelectClass(c.id)}
                >
                  <div>
                    <h3 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', fontWeight: 700, marginBottom: 8 }}>{c.name}</h3>
                    {!isProfessor && (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                        👨‍🏫 Teacher: <b>{c.teacher?.name}</b>
                      </p>
                    )}
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: '0.72rem',
                        fontFamily: 'monospace',
                        background: 'rgba(255,255,255,0.06)',
                        padding: '4px 8px',
                        borderRadius: 4,
                        color: 'var(--text-secondary)',
                        fontWeight: 600
                      }}
                    >
                      Join Code: <b>{c.code}</b>
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 16, marginTop: 24, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    <span>👥 <b>{c._count?.students ?? 0}</b> Students</span>
                    <span>📝 <b>{c._count?.exams ?? 0}</b> Exams</span>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : isProfessor ? (
          /* ==========================================================
             PROFESSOR CLASSROOM DETAIL VIEW
             ========================================================== */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {/* Metadata bar */}
            <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{selectedClass.name} Details</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  Invite students to register and join using this unique 6-character code.
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '1.2rem', fontFamily: 'monospace', background: 'rgba(255, 255, 255, 0.04)', border: '1px solid var(--border)', padding: '10px 20px', borderRadius: 8 }}>
                🔑 <b style={{ color: 'var(--yellow)', letterSpacing: '1px' }}>{selectedClass.code}</b>
              </div>
            </div>

            {/* Main Details Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24, alignItems: 'flex-start' }}>
              
              {/* Sidebar: Students & Exams */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {/* Enrolled Students */}
                <div className="card" style={{ padding: 20 }}>
                  <div className="card-title" style={{ marginBottom: 12 }}>👥 Enrolled Students ({selectedClass.students.length})</div>
                  {selectedClass.students.length === 0 ? (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>No students enrolled yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto', paddingRight: 4 }}>
                      {selectedClass.students.map((s) => (
                        <div key={s.id} style={{ display: 'flex', flexDirection: 'column', padding: '6px 10px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6 }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{s.email}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Assigned Exams */}
                <div className="card" style={{ padding: 20 }}>
                  <div className="card-title" style={{ marginBottom: 12 }}>📝 Assigned Exams ({selectedClass.exams.length})</div>
                  {selectedClass.exams.length === 0 ? (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>No exams assigned yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {selectedClass.exams.map((e) => (
                        <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6 }}>
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{e.title}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>⏱️ {e.duration} min</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Main Content Area: E2E Submissions & Rankings */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 16 }}>
                  <div>
                    <h3 className="card-title" style={{ fontSize: '1.1rem', fontWeight: 700 }}>📊 Student Performance & Submissions</h3>
                  </div>
                  {selectedClass.exams.length > 0 && (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <select
                        className="form-select"
                        style={{ fontSize: '0.85rem', width: 220 }}
                        value={selectedExamId}
                        onChange={(e) => setSelectedExamId(e.target.value)}
                      >
                        {selectedClass.exams.map((e) => (
                          <option key={e.id} value={e.id}>{e.title}</option>
                        ))}
                      </select>

                      <select
                        className="form-select"
                        style={{ fontSize: '0.85rem', width: 180 }}
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                      >
                        <option value="time">⏱️ Default (Time Given)</option>
                        <option value="marks-desc">📝 Marks: High to Low</option>
                        <option value="marks-asc">📝 Marks: Low to High</option>
                        <option value="trust-desc">🛡️ Trust: High to Low</option>
                        <option value="trust-asc">🛡️ Trust: Low to High</option>
                      </select>
                    </div>
                  )}
                </div>

                {selectedClass.exams.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                    <p style={{ margin: 0 }}>Assign exams to this classroom when creating exams in the <b>Exams</b> tab!</p>
                  </div>
                ) : getSortedSubmissions().length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                    <p style={{ margin: 0, fontStyle: 'italic' }}>No submissions recorded yet for this exam in this class.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {getSortedSubmissions().map((s) => {
                      const trust = calculateTrustScore(s.flags || []);
                      const meta = getTrustLabel(trust);

                      return (
                        <div
                          key={s.id}
                          className="card"
                          style={{
                            background: 'rgba(255,255,255,0.01)',
                            border: '1px solid var(--border)',
                            padding: '16px 20px',
                            display: 'grid',
                            gridTemplateColumns: '1fr 200px 200px',
                            alignItems: 'center',
                            gap: 16
                          }}
                        >
                          {/* Student Details */}
                          <div>
                            <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{s.studentName}</h4>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>{s.studentEmail}</p>
                            
                            {/* Flags Brief */}
                            {s.flags && s.flags.length > 0 && (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                                {s.flags.slice(0, 2).map((f) => (
                                  <span key={f.id} style={{ fontSize: '0.72rem', background: 'rgba(239, 68, 68, 0.08)', color: 'var(--red)', padding: '2px 6px', borderRadius: 4 }}>
                                    🚩 {f.notes || f.ruleId}
                                  </span>
                                ))}
                                {s.flags.length > 2 && (
                                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                    +{s.flags.length - 2} more...
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Dynamic Trust Score Badge */}
                          <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                background: meta.bg,
                                color: meta.color,
                                padding: '4px 10px',
                                borderRadius: '4px',
                                fontWeight: 800,
                                fontSize: '0.72rem',
                                border: `1px solid ${meta.color}33`,
                              }}
                              title={`Breaches count: ${s.flags?.length ?? 0}`}
                            >
                              🛡️ Trust: {trust}% ({meta.label})
                            </div>
                          </div>

                          {/* Grade & Score */}
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                            {s.score !== undefined ? (
                              <>
                                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--green)' }}>
                                  {s.score} / {s.maxPoints}
                                </span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                                  Grade: {((s.score / (s.maxPoints || 1)) * 100).toFixed(0)}%
                                </span>
                              </>
                            ) : (
                              <span style={{ fontStyle: 'italic', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                Attempting / Incomplete
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ==========================================================
             STUDENT CLASSROOM VIEW
             ========================================================== */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {/* Header info */}
            <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Class: {selectedClass.name}</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  👨‍🏫 Instructor: <b>{selectedClass.teacher?.name}</b> ({selectedClass.teacher?.email})
                </p>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                👥 {selectedClass.students?.length ?? 0} enrolled students
              </div>
            </div>

            {/* Exams assigned to this class */}
            <div className="card" style={{ padding: 24 }}>
              <div className="card-title" style={{ marginBottom: 16, fontSize: '1rem', fontWeight: 700 }}>
                📋 Assigned Classroom Exams
              </div>

              {selectedClass.exams.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                  <p style={{ margin: 0, fontStyle: 'italic' }}>No exams assigned to this classroom yet.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {selectedClass.exams.map((exam) => {
                    // Check if this student already attempted/completed this exam
                    const submission = classSubmissions.find((s) => s.examId === exam.id && s.studentName === user?.name);
                    const attempted = !!submission;

                    return (
                      <div
                        key={exam.id}
                        className="card"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '16px 20px',
                          background: 'linear-gradient(135deg, #161616 0%, #1c1c1c 100%)',
                          border: '1px solid rgba(255,255,255,0.05)'
                        }}
                      >
                        <div>
                          <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {exam.title}
                          </h3>
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                            ⏱️ Duration: <b>{exam.duration} minutes</b>
                          </p>
                        </div>

                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {attempted ? (
                            <>
                              <span style={{ fontSize: '0.8rem', color: 'var(--green)', fontWeight: 600, marginRight: 16 }}>
                                Score: {submission.score} / {submission.maxPoints}
                              </span>
                              <button
                                className="btn btn-outline btn-sm"
                                onClick={() => setRankingExam(exam)}
                              >
                                🏆 Class Rankings
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleGenerateStudentCode(exam)}
                            >
                              Start Test →
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ==========================================================
         PROFESSOR CREATE CLASS MODAL
         ========================================================== */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <span className="modal-title">Create Class / Batch</span>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateClass}>
              <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="form-label">Class Name</label>
                <input
                  className="form-input"
                  placeholder="e.g. Class XII-A, B. Tech CS 2027"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? <span className="spinner" /> : 'Create Class'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================================
         STUDENT JOIN CLASS MODAL
         ========================================================== */}
      {showJoinModal && (
        <div className="modal-overlay" onClick={() => setShowJoinModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <span className="modal-title">Join Class / Batch</span>
              <button className="modal-close" onClick={() => setShowJoinModal(false)}>×</button>
            </div>
            <form onSubmit={handleJoinClass}>
              <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="form-label">Enter 6-digit Classroom Code</label>
                <input
                  className="form-input"
                  placeholder="CL-XXXXXX"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={9}
                  required
                  style={{ textTransform: 'uppercase', textAlign: 'center', fontSize: '1.25rem', fontFamily: 'monospace', letterSpacing: '2px' }}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowJoinModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? <span className="spinner" /> : 'Join Class'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================================
         STUDENT EXAM START ACCESS CODE GENERATOR MODAL
         ========================================================== */}
      {startExamObj && (
        <div className="modal-overlay" onClick={() => setStartExamObj(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, textAlign: 'center', padding: '32px' }}>
            <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>🛡️</div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '8px' }}>Launch Secure Exam Environment</h2>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: '1.6' }}>
              You are launching <b>{startExamObj.title}</b>. Copy the Secure Access Key below, open your secureVision Electron app, and paste it to start the exam.
            </p>

            {generatingCode ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
                <span className="spinner" />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
                <div
                  style={{
                    background: 'rgba(245, 158, 11, 0.04)',
                    border: '2px dashed rgba(245, 158, 11, 0.3)',
                    borderRadius: '8px',
                    padding: '16px 24px',
                    fontSize: '2rem',
                    fontFamily: 'monospace',
                    fontWeight: 800,
                    letterSpacing: '4px',
                    color: 'var(--yellow)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                >
                  {generatedCode}
                </div>

                <div style={{ display: 'flex', gap: '12px', width: '100%', marginTop: '8px' }}>
                  <button
                    className="btn btn-outline"
                    style={{ flex: 1, height: '42px' }}
                    onClick={handleCopyCode}
                  >
                    {copied ? '✓ Copied!' : '📋 Copy Code'}
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1, height: '42px' }}
                    onClick={() => setStartExamObj(null)}
                  >
                    Got it, Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==========================================================
         STUDENT CLASS EXAM RANKING MODAL (PRIVACY COMPLIANT!)
         ========================================================== */}
      {rankingExam && (
        <div className="modal-overlay" onClick={() => setRankingExam(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <span className="modal-title">🏆 Class Rankings: {rankingExam.title}</span>
              <button className="modal-close" onClick={() => setRankingExam(null)}>×</button>
            </div>
            
            {/* Sorting trigger for rankings */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <select
                className="form-select"
                style={{ fontSize: '0.8rem', width: 180, height: '32px', padding: '0 8px' }}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="marks-desc">📝 Marks: High to Low</option>
                <option value="marks-asc">📝 Marks: Low to High</option>
              </select>
            </div>

            <div className="table-wrapper" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: 80, textAlign: 'center' }}>Rank</th>
                    <th>Student Name</th>
                    <th style={{ textAlign: 'right' }}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const submissions = classSubmissions
                      .filter((s) => s.examId === rankingExam.id && s.score !== undefined)
                      .sort((a, b) => {
                        if (sortBy === 'marks-asc') {
                          return (a.score ?? 0) - (b.score ?? 0);
                        }
                        return (b.score ?? 0) - (a.score ?? 0); // default marks-desc
                      });

                    if (submissions.length === 0) {
                      return (
                        <tr>
                          <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-secondary)', fontStyle: 'italic', padding: 24 }}>
                            No rankings available yet.
                          </td>
                        </tr>
                      );
                    }

                    return submissions.map((s, index) => {
                      const isMe = s.studentName === user?.name;
                      const rank = sortBy === 'marks-asc' ? submissions.length - index : index + 1;

                      return (
                        <tr key={s.id} style={{ background: isMe ? 'rgba(34, 211, 165, 0.04)' : 'transparent', fontWeight: isMe ? 700 : 'inherit' }}>
                          <td style={{ color: rank === 1 ? 'var(--yellow)' : 'var(--text-secondary)' }}>
                            {rank === 1 ? '🥇 1st' : rank === 2 ? '🥈 2nd' : rank === 3 ? '🥉 3rd' : `${rank}th`}
                          </td>
                          <td style={{ color: isMe ? 'var(--green)' : 'var(--text-primary)' }}>
                            {s.studentName} {isMe && '👤 (You)'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                            {s.score} / {s.maxPoints}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
              <button className="btn btn-primary" onClick={() => setRankingExam(null)}>
                Close Rankings
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface Exam {
  id: string;
  title: string;
  duration: number;
  startTime?: string;
}

interface PastSession {
  id: string;
  examTitle: string;
  duration: number;
  startedAt?: string;
  endedAt?: string;
  status: string;
  flagCount: number;
  score?: number;
  maxPoints?: number;
}

export default function StudentPortal() {
  const { user } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [pastSessions, setPastSessions] = useState<PastSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Modal states
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [entryCode, setEntryCode] = useState('');
  const [generatingCode, setGeneratingCode] = useState(false);
  const [copied, setCopied] = useState(false);

  // Review states
  const [reviewSession, setReviewSession] = useState<any>(null);
  const [loadingReview, setLoadingReview] = useState(false);

  useEffect(() => {
    fetchPortalData();
  }, []);

  async function fetchPortalData() {
    setLoading(true);
    setError('');
    try {
      const [examsRes, sessionsRes] = await Promise.all([
        api.get('/exams'),
        api.get('/sessions/my-sessions'),
      ]);
      setExams(examsRes.data.exams || []);
      setPastSessions(sessionsRes.data.sessions || []);
    } catch (e: any) {
      setError('Failed to fetch student dashboard data. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateCode(exam: Exam) {
    setSelectedExam(exam);
    setEntryCode('');
    setGeneratingCode(true);
    setCopied(false);
    try {
      const res = await api.post('/sessions/generate-code', { examId: exam.id });
      setEntryCode(res.data.entryCode);
    } catch (e: any) {
      alert(e.response?.data?.error || 'Could not generate exam code.');
      setSelectedExam(null);
    } finally {
      setGeneratingCode(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(entryCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleOpenReview(sessionId: string) {
    setLoadingReview(true);
    try {
      const res = await api.get(`/sessions/${sessionId}`);
      const sess = res.data.session;
      
      let examConfig: any = {};
      if (typeof sess.exam.configJson === 'string') {
        try { examConfig = JSON.parse(sess.exam.configJson); } catch {}
      } else {
        examConfig = sess.exam.configJson || {};
      }

      let submissionPayload: any = {};
      if (sess.events && sess.events.length > 0) {
        const ev = sess.events[0];
        if (typeof ev.payloadJson === 'string') {
          try { submissionPayload = JSON.parse(ev.payloadJson); } catch {}
        } else {
          submissionPayload = ev.payloadJson || {};
        }
      }

      setReviewSession({
        ...sess,
        parsedConfig: examConfig,
        parsedPayload: submissionPayload
      });
    } catch (e) {
      alert('Failed to load exam review details.');
    } finally {
      setLoadingReview(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <p className="page-subtitle">Welcome back,</p>
        <h1 className="page-title">{user?.name} 🎓</h1>
      </div>

      <div className="page-body">
        {error && <div className="alert alert-high">{error}</div>}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
            <span className="spinner" />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            
            {/* AVAILABLE EXAMS */}
            <div>
              <div className="card-title" style={{ marginBottom: '16px', fontSize: '1rem', fontWeight: 700 }}>
                📝 Active & Scheduled Exams
              </div>
              {exams.length === 0 ? (
                <div className="card empty-state">
                  <div className="empty-icon">📂</div>
                  <p>No exams are currently active for you.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {exams.map((exam) => (
                    <div 
                      key={exam.id} 
                      className="card" 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        padding: '20px 24px',
                        background: 'linear-gradient(135deg, #161616 0%, #1c1c1c 100%)',
                        border: '1px solid rgba(255,255,255,0.05)'
                      }}
                    >
                      <div>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {exam.title}
                        </h3>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          ⏱️ Duration: <b>{exam.duration} minutes</b>
                        </p>
                      </div>
                      <button 
                        className="btn btn-primary" 
                        onClick={() => handleGenerateCode(exam)}
                      >
                        Start Test →
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* MY PAST EXAMS */}
            <div>
              <div className="card-title" style={{ marginBottom: '16px', fontSize: '1rem', fontWeight: 700 }}>
                📜 My Past Submissions & Grades
              </div>
              {pastSessions.length === 0 ? (
                <div className="card empty-state">
                  <div className="empty-icon">⏳</div>
                  <p>You have not submitted any exams yet.</p>
                </div>
              ) : (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>Exam Name</th>
                          <th>Status</th>
                          <th>Flags</th>
                          <th>Grade</th>
                          <th>Finished At</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pastSessions.map((session) => (
                          <tr key={session.id}>
                            <td style={{ fontWeight: 600 }}>{session.examTitle}</td>
                            <td>
                              <span className={`badge ${
                                session.status === 'COMPLETED' ? 'badge-green' : 'badge-red'
                              }`}>
                                {session.status}
                              </span>
                            </td>
                            <td>
                              {session.flagCount > 0 ? (
                                <span style={{ color: 'var(--red)', fontWeight: 600 }}>
                                  🚩 {session.flagCount} flags
                                </span>
                              ) : (
                                <span style={{ color: 'var(--green)' }}>✓ Clean Session</span>
                              )}
                            </td>
                            <td>
                              {session.score !== undefined ? (
                                <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: '0.95rem' }}>
                                  {session.score} / {session.maxPoints ?? 0}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Pending Grade</span>
                              )}
                            </td>
                            <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                              {session.endedAt ? new Date(session.endedAt).toLocaleString() : 'N/A'}
                            </td>
                            <td>
                              {(session.status === 'COMPLETED' || session.status === 'TERMINATED') ? (
                                <button 
                                  className="btn btn-outline btn-sm" 
                                  style={{ fontSize: '0.75rem', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                  onClick={() => handleOpenReview(session.id)}
                                  disabled={loadingReview}
                                >
                                  🔍 Review
                                </button>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>In Progress</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* UNIQUE ACCESS CODE MODAL */}
      {selectedExam && (
        <div className="modal-overlay" onClick={() => setSelectedExam(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px', textAlign: 'center' }}>
            <div className="modal-header">
              <h3 className="modal-title">🔓 Exam Security Key</h3>
              <button className="modal-close" onClick={() => setSelectedExam(null)}>×</button>
            </div>
            
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '20px' }}>
              Your secure key for <b>{selectedExam.title}</b> has been generated. Use this code in the **secureVision desktop application** to start your exam.
            </p>

            {generatingCode ? (
              <div style={{ padding: '24px' }}>
                <span className="spinner" />
              </div>
            ) : (
              <div style={{ margin: '24px 0' }}>
                <div 
                  className="pulsing"
                  style={{
                    fontSize: '2.5rem',
                    fontWeight: 800,
                    fontFamily: 'monospace',
                    letterSpacing: '4px',
                    color: 'var(--accent-light)',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px dashed var(--border-bright)',
                    borderRadius: '8px',
                    padding: '16px 20px',
                    display: 'inline-block',
                    cursor: 'pointer'
                  }}
                  onClick={handleCopy}
                  title="Click to copy code"
                >
                  {entryCode}
                </div>
                
                <div style={{ marginTop: '12px' }}>
                  <button className="btn btn-outline btn-sm" onClick={handleCopy}>
                    {copied ? '✓ Copied!' : '📋 Copy Access Code'}
                  </button>
                </div>
              </div>
            )}

            <div 
              style={{ 
                background: 'rgba(239, 68, 68, 0.05)', 
                border: '1px solid rgba(239, 68, 68, 0.15)', 
                borderRadius: '8px',
                padding: '14px',
                textAlign: 'left',
                fontSize: '0.8rem',
                color: 'var(--red)',
                lineHeight: '1.5'
              }}
            >
              ⚠️ **CRITICAL SECURITY STEPS**:
              <ol style={{ paddingLeft: '16px', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <li>Do not close this browser tab.</li>
                <li>Launch the **secureVision Client** application.</li>
                <li>Enter this key to lock down your system and start the test.</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* DETAILED EXAM REVIEW MODAL */}
      {reviewSession && (
        <div className="modal-overlay" onClick={() => setReviewSession(null)}>
          <div 
            className="modal" 
            onClick={(e) => e.stopPropagation()} 
            style={{ 
              maxWidth: '800px', 
              width: '100%', 
              background: 'var(--bg-secondary)', 
              borderColor: 'var(--border-bright)' 
            }}
          >
            <div className="modal-header">
              <div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Post-Exam Review
                </span>
                <h3 className="modal-title" style={{ fontSize: '1.4rem', marginTop: '2px', color: 'var(--text-primary)' }}>
                  📝 {reviewSession.exam.title}
                </h3>
              </div>
              <button 
                className="modal-close" 
                onClick={() => setReviewSession(null)} 
                style={{ fontSize: '1.8rem' }}
              >
                ×
              </button>
            </div>

            {/* SCORE SUMMARY CARD */}
            <div 
              style={{ 
                background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '24px',
                marginBottom: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '20px'
              }}
            >
              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  Exam Status: <span className="badge badge-green" style={{ textTransform: 'capitalize', marginLeft: '6px' }}>{reviewSession.status.toLowerCase()}</span>
                </div>
                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {reviewSession.flagCount > 0 ? (
                    <span className="badge badge-red">🚩 {reviewSession.flagCount} Proctor Flags</span>
                  ) : (
                    <span className="badge badge-green">✓ Clean Proctor Session</span>
                  )}
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Finished: {reviewSession.endedAt ? new Date(reviewSession.endedAt).toLocaleString() : 'N/A'}
                  </span>
                </div>
              </div>

              <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Final Score
                  </div>
                  <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--green)', fontFamily: 'var(--font-heading)' }}>
                    {reviewSession.parsedPayload.score} <span style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', fontWeight: 500 }}>/ {reviewSession.parsedPayload.maxPoints || 0}</span>
                  </div>
                </div>
                <div 
                  style={{ 
                    background: 'rgba(34, 211, 165, 0.1)', 
                    border: '1px solid rgba(34, 211, 165, 0.2)',
                    borderRadius: '8px', 
                    padding: '8px 12px',
                    textAlign: 'center' 
                  }}
                >
                  <div style={{ fontSize: '0.65rem', color: 'var(--green)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
                    Grade
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--green)' }}>
                    {reviewSession.parsedPayload.maxPoints 
                      ? ((reviewSession.parsedPayload.score / reviewSession.parsedPayload.maxPoints) * 100).toFixed(1) 
                      : '0.0'}%
                  </div>
                </div>
              </div>
            </div>

            {/* Proctor Penalty / Adjustment Warning */}
            {reviewSession.parsedPayload.isPenalized && (
              <div 
                className="alert alert-medium" 
                style={{ 
                  marginBottom: '28px', 
                  background: 'rgba(245, 158, 11, 0.08)',
                  borderColor: 'rgba(245, 158, 11, 0.4)',
                  color: 'var(--yellow)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  borderRadius: '8px'
                }}
              >
                <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Grade Manually Adjusted by Proctor</div>
                  <div style={{ fontSize: '0.8rem', opacity: 0.9, marginTop: '2px' }}>
                    Original Score: <b>{reviewSession.parsedPayload.originalScore}</b> · Reason: <i>{reviewSession.parsedPayload.penaltyReason || 'Rule Breach Penalty'}</i>
                  </div>
                </div>
              </div>
            )}

            {/* QUESTIONS BREAKDOWN SECTION */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                📖 Questions & Responses Review
              </h4>

              {(reviewSession.parsedConfig.questions || []).map((q: any, qi: number) => {
                const studentAns = reviewSession.parsedPayload.answers?.[q.id];
                let isCorrect = false;

                if (q.type === 'multiple_choice') {
                  isCorrect = studentAns === q.answer;
                } else if (q.type === 'short_answer') {
                  isCorrect = q.answer && String(studentAns).toLowerCase().trim() === String(q.answer).toLowerCase().trim();
                }

                return (
                  <div 
                    key={q.id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.015)',
                      border: `1px solid ${isCorrect ? 'rgba(34, 211, 165, 0.2)' : (studentAns === undefined || studentAns === '') ? 'var(--border)' : 'rgba(239, 68, 68, 0.2)'}`,
                      borderRadius: '10px',
                      padding: '20px',
                      position: 'relative'
                    }}
                  >
                    {/* Header badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                        Question {qi + 1} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {q.points || 0} pts</span>
                      </span>
                      {isCorrect ? (
                        <span className="badge badge-green" style={{ fontSize: '0.7rem' }}>✓ Correct</span>
                      ) : studentAns === undefined || studentAns === '' ? (
                        <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', fontSize: '0.7rem' }}>✗ Unanswered</span>
                      ) : (
                        <span className="badge badge-red" style={{ fontSize: '0.7rem' }}>✗ Incorrect</span>
                      )}
                    </div>

                    {/* Question Text */}
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px', lineHeight: '1.5' }}>
                      {q.text}
                    </div>

                    {/* Options Review for Multiple Choice */}
                    {q.type === 'multiple_choice' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {(q.options || []).map((option: string, oi: number) => {
                          const isStudentSelected = studentAns === oi;
                          const isCorrectOption = q.answer === oi;

                          let itemBg = 'rgba(255, 255, 255, 0.02)';
                          let itemBorder = '1px solid var(--border)';
                          let itemColor = 'var(--text-secondary)';

                          if (isCorrectOption) {
                            itemBg = 'rgba(34, 211, 165, 0.08)';
                            itemBorder = '1px solid rgba(34, 211, 165, 0.4)';
                            itemColor = 'var(--green)';
                          } else if (isStudentSelected && !isCorrectOption) {
                            itemBg = 'rgba(239, 68, 68, 0.08)';
                            itemBorder = '1px solid rgba(239, 68, 68, 0.4)';
                            itemColor = 'var(--red)';
                          }

                          return (
                            <div 
                              key={oi}
                              style={{
                                background: itemBg,
                                border: itemBorder,
                                borderRadius: '6px',
                                padding: '10px 14px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                color: itemColor,
                                fontSize: '0.88rem'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div 
                                  style={{ 
                                    width: '18px', 
                                    height: '18px', 
                                    borderRadius: '50%', 
                                    border: `2px solid ${isCorrectOption ? 'var(--green)' : isStudentSelected ? 'var(--red)' : 'var(--border-bright)'}`,
                                    background: isCorrectOption || isStudentSelected ? 'currentColor' : 'transparent',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#000',
                                    fontSize: '0.6rem',
                                    fontWeight: 800
                                  }}
                                >
                                  {(isCorrectOption || isStudentSelected) && '✓'}
                                </div>
                                <span style={{ color: isCorrectOption ? 'var(--text-primary)' : isStudentSelected ? 'var(--text-primary)' : 'inherit' }}>
                                  {option}
                                </span>
                              </div>

                              <span style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                {isCorrectOption && isStudentSelected && '✨ Your Correct Answer'}
                                {isCorrectOption && !isStudentSelected && '✓ Correct Option'}
                                {!isCorrectOption && isStudentSelected && '✗ Your Wrong Selection'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* Short Answer Review */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div 
                          style={{ 
                            background: studentAns ? (isCorrect ? 'rgba(34, 211, 165, 0.04)' : 'rgba(239, 68, 68, 0.04)') : 'rgba(255, 255, 255, 0.01)',
                            border: `1px solid ${studentAns ? (isCorrect ? 'rgba(34, 211, 165, 0.2)' : 'rgba(239, 68, 68, 0.2)') : 'var(--border)'}`,
                            borderRadius: '6px',
                            padding: '12px 16px',
                            fontSize: '0.88rem'
                          }}
                        >
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>
                            Your Response:
                          </span>
                          <span style={{ fontWeight: 600, color: studentAns ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {studentAns || 'No response submitted'}
                          </span>
                        </div>

                        <div 
                          style={{ 
                            background: 'rgba(34, 211, 165, 0.04)',
                            border: '1px solid rgba(34, 211, 165, 0.2)',
                            borderRadius: '6px',
                            padding: '12px 16px',
                            fontSize: '0.88rem'
                          }}
                        >
                          <span style={{ fontSize: '0.75rem', color: 'var(--green)', display: 'block', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>
                            Correct Answer:
                          </span>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {q.answer}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '32px' }}>
              <button className="btn btn-primary" onClick={() => setReviewSession(null)}>
                Close Review
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

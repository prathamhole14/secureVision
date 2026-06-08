import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';

interface Option {
  text: string;
}

interface Question {
  id: string;
  type: 'multiple_choice' | 'short_answer';
  text: string;
  points: number;
  options?: string[];
  answer?: number | string; // index for MCQ, string for Short Answer
}

interface Exam {
  id: string;
  title: string;
  configJson: string;
}

const blankMCQ = (): Omit<Question, 'id'> => ({
  type: 'multiple_choice',
  text: '',
  points: 1,
  options: ['', '', '', ''],
  answer: 0,
});

const blankShort = (): Omit<Question, 'id'> => ({
  type: 'short_answer',
  text: '',
  points: 1,
  answer: '',
});

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function QuestionsPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();

  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Add form state
  const [addType, setAddType] = useState<'multiple_choice' | 'short_answer'>('multiple_choice');
  const [newQ, setNewQ] = useState<Omit<Question, 'id'>>(blankMCQ());

  useEffect(() => {
    async function load() {
      try {
        const r = await api.get(`/exams/${examId}`);
        const e = r.data.exam;
        setExam(e);
        const cfg = typeof e.configJson === 'string' ? JSON.parse(e.configJson) : e.configJson;
        setQuestions((cfg?.questions as Question[]) || []);
      } catch {
        setError('Failed to load exam');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [examId]);

  function handleTypeChange(t: 'multiple_choice' | 'short_answer') {
    setAddType(t);
    setNewQ(t === 'multiple_choice' ? blankMCQ() : blankShort());
  }

  function handleOptionChange(idx: number, val: string) {
    const opts = [...((newQ.options as string[]) || [])];
    opts[idx] = val;
    setNewQ({ ...newQ, options: opts });
  }

  function handleAddQuestion() {
    if (!newQ.text.trim()) return;
    
    if (newQ.type === 'short_answer' && !String(newQ.answer || '').trim()) {
      setError('Please provide the correct answer for the short answer question.');
      return;
    }

    let processedQ = { ...newQ, id: newId() };

    if (newQ.type === 'multiple_choice') {
      // Find the original correct option text
      const originalOptions = newQ.options || [];
      const correctOptionText = originalOptions[typeof newQ.answer === 'number' ? newQ.answer : 0] || '';

      // Filter out empty options
      const filteredOpts = originalOptions.filter((o) => o.trim() !== '');
      
      if (filteredOpts.length < 2) {
        setError('Please provide at least 2 options for MCQ.');
        return;
      }

      // Re-map the answer index to the new filtered array
      // If the previously selected correct answer was empty, default to 0
      let newAnswerIndex = filteredOpts.indexOf(correctOptionText);
      if (newAnswerIndex === -1) newAnswerIndex = 0;

      processedQ.options = filteredOpts;
      processedQ.answer = newAnswerIndex;
    }

    setError('');
    setQuestions([...questions, processedQ]);
    setNewQ(addType === 'multiple_choice' ? blankMCQ() : blankShort());
  }

  function handleDeleteQuestion(id: string) {
    setQuestions(questions.filter((q) => q.id !== id));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      await api.put(`/exams/${examId}/questions`, { questions });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to save questions');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <span className="spinner" />
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <p className="page-subtitle">
            <span
              onClick={() => navigate('/exams')}
              style={{ cursor: 'pointer', color: 'var(--accent)' }}
            >
              Exams
            </span>
            {' / '}
            {exam?.title}
          </p>
          <h1 className="page-title">Question Bank</h1>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-outline" onClick={() => navigate('/exams')}>
            ← Back
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner" /> : '💾 Save Questions'}
          </button>
        </div>
      </div>

      <div className="page-body">
        {error && <div className="alert alert-high">{error}</div>}
        {success && <div className="alert alert-low">✅ Questions saved successfully! They will appear in the student app.</div>}

        {/* Two-column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24, alignItems: 'start' }}>

          {/* LEFT: Questions list */}
          <div>
            <div className="card-title" style={{ marginBottom: 16 }}>
              {questions.length} Question{questions.length !== 1 ? 's' : ''}
              {' '}
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>
                · {questions.reduce((s, q) => s + q.points, 0)} total pts
              </span>
            </div>

            {questions.length === 0 ? (
              <div className="card empty-state">
                <div className="empty-icon">❓</div>
                <p>No questions yet. Add some using the form on the right.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {questions.map((q, i) => (
                  <div className="card" key={q.id} style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                          <span style={{
                            fontWeight: 700,
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}>
                            Q{i + 1}
                          </span>
                          <span className={`badge ${q.type === 'multiple_choice' ? 'badge-blue' : 'badge-yellow'}`}>
                            {q.type === 'multiple_choice' ? 'MCQ' : 'Short Answer'}
                          </span>
                          <span className="badge badge-green">{q.points} pts</span>
                        </div>
                        <div style={{ fontWeight: 500, marginBottom: 8, lineHeight: 1.5 }}>{q.text}</div>
                        {q.type === 'multiple_choice' && q.options && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {q.options.filter(Boolean).map((opt, oi) => (
                              <div
                                key={oi}
                                style={{
                                  fontSize: '0.82rem',
                                  padding: '4px 10px',
                                  borderRadius: 6,
                                  background: oi === q.answer ? 'var(--green-bg)' : 'transparent',
                                  color: oi === q.answer ? 'var(--green)' : 'var(--text-secondary)',
                                  border: `1px solid ${oi === q.answer ? 'rgba(34,211,165,0.3)' : 'transparent'}`,
                                }}
                              >
                                {oi === q.answer && '✓ '}{opt}
                              </div>
                            ))}
                          </div>
                        )}
                        {q.type === 'short_answer' && (
                          <div
                            style={{
                              fontSize: '0.82rem',
                              padding: '6px 12px',
                              borderRadius: 6,
                              background: 'var(--green-bg)',
                              color: 'var(--green)',
                              border: '1px solid rgba(34,211,165,0.3)',
                              display: 'inline-block',
                              marginTop: 4,
                            }}
                          >
                            Correct Answer: <b>{q.answer}</b>
                          </div>
                        )}
                      </div>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDeleteQuestion(q.id)}
                        title="Delete question"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT: Add question form */}
          <div className="card" style={{ position: 'sticky', top: 24 }}>
            <div className="card-title" style={{ marginBottom: 20 }}>Add Question</div>

            {/* Type selector */}
            <div className="form-group">
              <label className="form-label">Question Type</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['multiple_choice', 'short_answer'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTypeChange(t)}
                    className={`btn btn-sm ${addType === t ? 'btn-primary' : 'btn-outline'}`}
                    style={{ flex: 1 }}
                  >
                    {t === 'multiple_choice' ? '● MCQ' : '✏️ Short'}
                  </button>
                ))}
              </div>
            </div>

            {/* Question text */}
            <div className="form-group">
              <label className="form-label">Question Text *</label>
              <textarea
                className="form-textarea"
                placeholder="Enter question here…"
                value={newQ.text}
                onChange={(e) => setNewQ({ ...newQ, text: e.target.value })}
                style={{ minHeight: 80 }}
              />
            </div>

            {/* Points */}
            <div className="form-group">
              <label className="form-label">Points</label>
              <input
                type="number"
                className="form-input"
                min={1}
                value={newQ.points}
                onChange={(e) => setNewQ({ ...newQ, points: parseInt(e.target.value) || 1 })}
              />
            </div>

            {/* MCQ options */}
            {addType === 'multiple_choice' && (
              <>
                <div className="form-group">
                  <label className="form-label">Options (* = correct)</label>
                  {(newQ.options || ['', '', '', '']).map((opt, oi) => (
                    <div key={oi} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <input
                        type="radio"
                        name="correct-opt"
                        checked={newQ.answer === oi}
                        onChange={() => setNewQ({ ...newQ, answer: oi })}
                        style={{ marginTop: 10, accentColor: 'var(--green)', flexShrink: 0 }}
                        title="Mark as correct answer"
                      />
                      <input
                        className="form-input"
                        placeholder={`Option ${oi + 1}`}
                        value={opt}
                        onChange={(e) => handleOptionChange(oi, e.target.value)}
                      />
                    </div>
                  ))}
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    Select the radio button next to the correct answer.
                  </p>
                </div>
              </>
            )}
            
            {/* Short Answer correct answer */}
            {addType === 'short_answer' && (
              <div className="form-group">
                <label className="form-label">Correct Answer *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter the correct answer..."
                  value={newQ.answer as string || ''}
                  onChange={(e) => setNewQ({ ...newQ, answer: e.target.value })}
                  required
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Case-insensitive exact match will be used for auto-grading.
                </p>
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={handleAddQuestion}
            >
              + Add Question
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

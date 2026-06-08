import { useAuth } from '../contexts/AuthContext';
import { useState } from 'react';
import api from '../lib/api';

export default function LoginPage() {
  const { loginWithToken } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'STUDENT' | 'PROFESSOR'>('STUDENT');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password || (isSignUp && !name)) {
      setError('Please fill in all fields.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (isSignUp) {
        // Register
        const res = await api.post('/auth/register', {
          name,
          email,
          password,
          role,
        });
        loginWithToken(res.data.token, res.data.user);
      } else {
        // Login
        const res = await api.post('/auth/login', {
          email,
          password,
        });
        loginWithToken(res.data.token, res.data.user);
      }
      
      // Hard redirect to clear cache and load portal matching role
      window.location.href = '/';
    } catch (e: any) {
      setError(e.response?.data?.error || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  // Fallback demo logins to make local development super convenient
  async function handleDemoLogin(roleType: 'STUDENT' | 'PROFESSOR') {
    setLoading(true);
    setError('');
    const demoTokenMap = {
      STUDENT: 'demo-student-token',
      PROFESSOR: 'demo-professor-token',
    };
    try {
      const res = await api.post('/auth/google', {
        id_token: demoTokenMap[roleType],
      });
      loginWithToken(res.data.token, res.data.user);
      window.location.href = '/';
    } catch (e: any) {
      setError(e.response?.data?.error || 'Demo login failed. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: '440px', padding: '40px 32px' }}>
        <div className="logo-icon" style={{ fontSize: '3.5rem', marginBottom: '8px' }}>🛡️</div>
        <h1 style={{ marginBottom: '4px', letterSpacing: '-0.02em' }}>secureVision</h1>
        <p style={{ fontSize: '0.9rem', marginBottom: '24px', color: 'var(--text-secondary)' }}>
          {isSignUp 
            ? 'Create a secure account for your institution' 
            : 'Secure examination portal for educational institutions'}
        </p>

        {error && (
          <div className="alert alert-high" style={{ textAlign: 'left', fontSize: '0.85rem', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
          {isSignUp && (
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="Enter your full name" 
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                required 
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input 
              type="email" 
              className="form-input" 
              placeholder="e.g. name@university.edu" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required 
            />
          </div>

          <div className="form-group" style={{ marginBottom: isSignUp ? '20px' : '28px' }}>
            <label className="form-label">Password</label>
            <input 
              type="password" 
              className="form-input" 
              placeholder="Min. 6 characters" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              required 
            />
          </div>

          {isSignUp && (
            <div className="form-group" style={{ marginBottom: '28px' }}>
              <label className="form-label">Select Account Type</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className={`btn ${role === 'STUDENT' ? 'btn-primary' : 'btn-outline'}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => setRole('STUDENT')}
                >
                  👨‍🎓 Student
                </button>
                <button
                  type="button"
                  className={`btn ${role === 'PROFESSOR' ? 'btn-primary' : 'btn-outline'}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => setRole('PROFESSOR')}
                >
                  👩‍🏫 Professor
                </button>
              </div>
            </div>
          )}

          <button 
            type="submit" 
            className="btn btn-primary" 
            style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: '0.95rem' }} 
            disabled={loading}
          >
            {loading ? <span className="spinner" /> : (isSignUp ? 'Sign Up' : 'Sign In')}
          </button>
        </form>

        <div style={{ marginTop: '20px', fontSize: '0.85rem' }}>
          <span style={{ color: 'var(--text-secondary)' }}>
            {isSignUp ? 'Already have an account? ' : "Don't have an account yet? "}
          </span>
          <button 
            type="button" 
            style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: '600', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
          >
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </div>

        {/* Demo login bypass fallback */}
        <div style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            ⚡ Fast Developer Demo Entry:
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              type="button" 
              className="btn btn-outline btn-sm" 
              style={{ flex: 1, justifyContent: 'center', fontSize: '0.75rem', padding: '6px' }}
              onClick={() => handleDemoLogin('STUDENT')}
            >
              Demo Student
            </button>
            <button 
              type="button" 
              className="btn btn-outline btn-sm" 
              style={{ flex: 1, justifyContent: 'center', fontSize: '0.75rem', padding: '6px' }}
              onClick={() => handleDemoLogin('PROFESSOR')}
            >
              Demo Professor
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
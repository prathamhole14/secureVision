import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardLayout from './components/DashboardLayout';
import HomePage from './pages/HomePage';
import ExamsPage from './pages/ExamsPage';
import MonitorPage from './pages/MonitorPage';
import ReportPage from './pages/ReportPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="login-page"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'PROFESSOR' && user.role !== 'ADMIN') {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="logo-icon">🚫</div>
          <h1>Access Denied</h1>
          <p>This dashboard is for professors and administrators only.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<HomePage />} />
            <Route path="exams" element={<ExamsPage />} />
            <Route path="monitor/:examId" element={<MonitorPage />} />
            <Route path="reports/:sessionId" element={<ReportPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

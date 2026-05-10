import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AdminLogin from './pages/AdminLogin';
import Dashboard from './pages/Dashboard';
import StudentRegistration from './pages/StudentRegistration';
import LiveMonitoring from './pages/LiveMonitoring';
import VideoAnalysis from './pages/VideoAnalysis';
import AlertsLogs from './pages/AlertsLogs';
import StudentRecords from './pages/StudentRecords';
import Settings from './pages/Settings';

import Layout from './components/Layout';

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" />;
  return <Layout>{children}</Layout>;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<AdminLogin />} />
        
        <Route path="/" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        
        <Route path="/registration" element={
          <ProtectedRoute>
            <StudentRegistration />
          </ProtectedRoute>
        } />
        
        <Route path="/monitoring" element={
          <ProtectedRoute>
            <LiveMonitoring />
          </ProtectedRoute>
        } />
        
        <Route path="/analysis" element={
          <ProtectedRoute>
            <VideoAnalysis />
          </ProtectedRoute>
        } />
        
        <Route path="/alerts" element={
          <ProtectedRoute>
            <AlertsLogs />
          </ProtectedRoute>
        } />
        
        <Route path="/records" element={
          <ProtectedRoute>
            <StudentRecords />
          </ProtectedRoute>
        } />
        
        <Route path="/settings" element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        } />
      </Routes>
    </Router>
  );
}

export default App;

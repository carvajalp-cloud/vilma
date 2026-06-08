import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Guards routes by authentication and (optionally) role.
export default function ProtectedRoute({ children, roles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <div className="content"><div className="card">Access denied — requires role: {roles.join(', ')}</div></div>;
  }
  return children;
}

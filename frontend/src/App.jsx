import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage.jsx'
import StatusPage from './pages/StatusPage.jsx'
import { useAuth } from './context/AuthContext.jsx'

// Gate the status page behind authentication; bounce guests to /login.
function RequireAuth({ children }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <StatusPage />
          </RequireAuth>
        }
      />
      {/* Unknown paths fall back to the home route. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

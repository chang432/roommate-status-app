import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import LoginPage from './pages/LoginPage.jsx'
import StatusPage from './pages/StatusPage.jsx'
import { useAuth } from './context/AuthContext.jsx'

// Gate the status page behind authentication; bounce guests to /login.
function RequireAuth({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  return user ? (
    children
  ) : (
    <Navigate
      to="/login"
      replace
      state={{ returnTo: `${location.pathname}${location.search}` }}
    />
  )
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

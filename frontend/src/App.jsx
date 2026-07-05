import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import LoginPage from './pages/LoginPage.jsx'
import PendingAccountPage from './pages/PendingAccountPage.jsx'
import StatusPage from './pages/StatusPage.jsx'
import { useAuth } from './context/AuthContext.jsx'

function RequireAccount({ children }) {
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

// Household features stay locked until a future group-join flow assigns groupId.
function RequireGroup({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo: `${location.pathname}${location.search}` }}
      />
    )
  }
  return user.hasGroup ? children : <Navigate to="/pending" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/pending"
        element={
          <RequireAccount>
            <PendingAccountPage />
          </RequireAccount>
        }
      />
      <Route
        path="/"
        element={
          <RequireGroup>
            <StatusPage />
          </RequireGroup>
        }
      />
      {/* Unknown paths fall back to the home route. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

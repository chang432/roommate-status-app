import { createContext, useContext, useState, useCallback } from 'react'
import { login as apiLogin } from '../api/client.js'

// Holds the signed-in roommate and exposes login/logout. The session is kept in
// localStorage so a refresh doesn't bounce the user back to the login page.
const AuthContext = createContext(null)

const SESSION_KEY = 'roomie-session'

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readSession)

  const login = useCallback(async (name, password) => {
    const { user: signedIn } = await apiLogin(name, password)
    setUser(signedIn)
    localStorage.setItem(SESSION_KEY, JSON.stringify(signedIn))
    return signedIn
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem(SESSION_KEY)
  }, [])

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook colocated with its provider
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

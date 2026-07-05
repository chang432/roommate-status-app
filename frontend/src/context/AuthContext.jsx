import { createContext, useContext, useState, useCallback } from 'react'
import {
  createAccount as apiCreateAccount,
  deleteAccount as apiDeleteAccount,
  joinGroup as apiJoinGroup,
  login as apiLogin,
} from '../api/client.js'

// Holds the signed-in roommate and exposes login/logout. The session is kept in
// localStorage so a refresh doesn't bounce the user back to the login page.
const AuthContext = createContext(null)

const SESSION_KEY = 'roomie-session'

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const user = JSON.parse(raw)
    const hasGroup = user.hasGroup ?? (user.groupId ? true : user.groupId === undefined)
    return { ...user, hasGroup }
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readSession)

  const persistUser = useCallback((signedIn) => {
    setUser(signedIn)
    localStorage.setItem(SESSION_KEY, JSON.stringify(signedIn))
    return signedIn
  }, [])

  const login = useCallback(async (username, password) => {
    const { user: signedIn } = await apiLogin(username, password)
    return persistUser(signedIn)
  }, [persistUser])

  const createAccount = useCallback(async (username, name, password) => {
    const { user: signedIn } = await apiCreateAccount(username, name, password)
    return persistUser(signedIn)
  }, [persistUser])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem(SESSION_KEY)
  }, [])

  const deleteAccount = useCallback(async (password) => {
    if (!user) return
    await apiDeleteAccount(user.id, password)
    logout()
  }, [logout, user])

  const joinGroup = useCallback(async (code) => {
    if (!user) return null
    const { user: joined } = await apiJoinGroup(user.id, code)
    return persistUser(joined)
  }, [persistUser, user])

  return (
    <AuthContext.Provider value={{
      user,
      login,
      createAccount,
      joinGroup,
      deleteAccount,
      logout,
    }}
    >
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

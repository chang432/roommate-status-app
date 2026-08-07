import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import {
  createAccount as apiCreateAccount,
  deleteAccount as apiDeleteAccount,
  getAccount as apiGetAccount,
  login as apiLogin,
  updateAccount as apiUpdateAccount,
  updatePassword as apiUpdatePassword,
} from '../api/accounts.js'
import { createGroup as apiCreateGroup, joinGroup as apiJoinGroup } from '../api/groups.js'
import { setInvalidUserHandler } from '../api/request.js'

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
    return persistUser({ ...signedIn, activeGroupId: signedIn.groupId })
  }, [persistUser])

  const createAccount = useCallback(async (username, name, password) => {
    const { user: signedIn } = await apiCreateAccount(username, name, password)
    return persistUser(signedIn)
  }, [persistUser])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem(SESSION_KEY)
  }, [])

  // Any API response flagged `invalid_user` means the stored session points at
  // an account the backend no longer knows (locally the in-memory DB is wiped
  // on every restart) — clear it so the app returns to the login page.
  useEffect(() => {
    setInvalidUserHandler(logout)
    return () => setInvalidUserHandler(null)
  }, [logout])

  // Re-validate the stored session once on load: refresh it with server truth
  // (groupId/hasGroup may have changed) or, if the account is gone, the
  // invalid_user handler above logs out. Network failures keep the session —
  // a briefly unreachable backend shouldn't sign anyone out.
  useEffect(() => {
    const stored = readSession()
    if (!stored) return
    apiGetAccount(stored.id)
      .then(({ user: fresh }) => persistUser({
        ...fresh,
        activeGroupId: stored.activeGroupId ?? fresh.groupId,
      }))
      .catch(() => {})
  }, [persistUser])

  const deleteAccount = useCallback(async (password) => {
    if (!user) return
    await apiDeleteAccount(user.id, password)
    logout()
  }, [logout, user])

  const updateProfile = useCallback(async (name, currentPassword) => {
    if (!user) return null
    try {
      const { user: updated } = await apiUpdateAccount(user.id, name, currentPassword)
      return persistUser({ ...updated, activeGroupId: user.activeGroupId })
    } catch (error) {
      if (error.data?.user) {
        persistUser({ ...error.data.user, activeGroupId: user.activeGroupId })
      }
      throw error
    }
  }, [persistUser, user])

  const updatePassword = useCallback(async (currentPassword, newPassword) => {
    if (!user) return null
    return apiUpdatePassword(user.id, currentPassword, newPassword)
  }, [user])

  const joinGroup = useCallback(async (code) => {
    if (!user) return null
    const { user: joined, group } = await apiJoinGroup(user.id, code)
    return persistUser({ ...joined, activeGroupId: group.groupId })
  }, [persistUser, user])

  const selectGroup = useCallback((groupId) => {
    if (!user || !groupId || groupId === user.activeGroupId) return
    persistUser({ ...user, activeGroupId: groupId })
  }, [persistUser, user])

  const createGroup = useCallback(async (name) => {
    if (!user) return null
    const { user: created, group } = await apiCreateGroup(user.id, name)
    return persistUser({ ...created, activeGroupId: group.groupId })
  }, [persistUser, user])

  return (
    <AuthContext.Provider value={{
      user,
      login,
      createAccount,
      joinGroup,
      selectGroup,
      createGroup,
      deleteAccount,
      updateProfile,
      updatePassword,
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

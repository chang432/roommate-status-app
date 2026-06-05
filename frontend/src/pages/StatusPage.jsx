import { useEffect, useMemo, useState } from 'react'
import Brandmark from '../components/Brandmark.jsx'
import YouCard from '../components/YouCard.jsx'
import EditPanel from '../components/EditPanel.jsx'
import StatusCard from '../components/StatusCard.jsx'
import NotificationBanner from '../components/NotificationBanner.jsx'
import EnableNotifications from '../components/EnableNotifications.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { getRoommates, updateStatus } from '../api/client.js'
import { availableCount, AVAILABLE_THRESHOLD } from '../utils/status.js'
import { avatarColor } from '../utils/avatar.js'

// A friendly "Tuesday evening" style subtitle based on the current time.
function whenLabel() {
  const now = new Date()
  const day = now.toLocaleDateString(undefined, { weekday: 'long' })
  const hour = now.getHours()
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
  return `${day} ${part} · who’s around?`
}

export default function StatusPage() {
  const { user, logout } = useAuth()

  const [roommates, setRoommates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Load the household on mount.
  useEffect(() => {
    let active = true
    getRoommates()
      .then((list) => active && setRoommates(list))
      .catch(() => active && setError('Could not load roommate statuses.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  // Split the list into "you" and everyone else, preserving the original index
  // so avatar colors stay stable.
  const { me, meIndex, others } = useMemo(() => {
    const idx = roommates.findIndex((r) => r.id === user.id)
    return {
      me: roommates[idx] ?? null,
      meIndex: idx,
      others: roommates.filter((r) => r.id !== user.id),
    }
  }, [roommates, user.id])

  const freeCount = availableCount(roommates)
  const showBanner = freeCount >= AVAILABLE_THRESHOLD

  async function handleSave(status, statusText) {
    setSaving(true)
    setError('')
    try {
      const updated = await updateStatus(user.id, status, statusText)
      setRoommates(updated)
      setEditing(false)
    } catch {
      setError('Could not save your status. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-[640px] px-[22px] pb-16 pt-10">
      <header className="mb-2 flex items-center gap-[14px]">
        <Brandmark className="h-[46px] w-[46px]" iconClassName="h-[26px] w-[26px]" />
        <div className="flex-1">
          <h1 className="font-display text-[24px] font-semibold leading-[1.1] -tracking-[0.01em]">
            York Terrace Roomie Status
          </h1>
          <p className="mt-[2px] text-[13.5px] text-ink-soft">{whenLabel()}</p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex-none rounded-full border border-line bg-white px-[14px] py-[7px] text-[13px] font-bold text-ink-soft transition hover:bg-[#faf6ef]"
        >
          Sign out
        </button>
      </header>

      {error && (
        <p className="mt-4 rounded-sm bg-[#fbeae6] px-3 py-2 text-[13.5px] font-semibold text-status-red">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-10 text-center text-[14px] text-ink-soft">Loading the household…</p>
      ) : (
        <>
          <EnableNotifications />

          {showBanner && <NotificationBanner count={freeCount} />}

          {me && (
            <div className="mb-[26px] mt-[22px]">
              <YouCard
                roommate={me}
                avatarColor={avatarColor(meIndex)}
                onEdit={() => setEditing((v) => !v)}
              />
            </div>
          )}

          {editing && me && (
            <EditPanel
              roommate={me}
              saving={saving}
              onSave={handleSave}
              onCancel={() => setEditing(false)}
            />
          )}

          <p className="mb-3 ml-[2px] text-[12.5px] font-bold uppercase tracking-[0.05em] text-ink-soft">
            The household
          </p>
          <div className="grid grid-cols-2 gap-[14px] max-[520px]:grid-cols-1">
            {others.map((roommate) => (
              <StatusCard key={roommate.id} roommate={roommate} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

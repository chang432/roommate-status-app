import { useCallback, useEffect, useMemo, useState } from 'react'
import Brandmark from '../components/Brandmark.jsx'
import YouCard from '../components/YouCard.jsx'
import EditPanel from '../components/EditPanel.jsx'
import StatusCard from '../components/StatusCard.jsx'
import NotificationBanner from '../components/NotificationBanner.jsx'
import LiveEventBanner from '../components/LiveEventBanner.jsx'
import EnableNotifications from '../components/EnableNotifications.jsx'
import ProposeActivity from '../components/ProposeActivity.jsx'
import PullToRefreshIndicator from '../components/PullToRefreshIndicator.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import {
  endActivity,
  getActivities,
  getRoommates,
  notifyRoommatesToUpdateStatus,
  startActivity,
  updateStatus,
} from '../api/client.js'
import { usePullToRefresh } from '../utils/usePullToRefresh.js'
import { availableCount, AVAILABLE_THRESHOLD } from '../utils/status.js'
import { avatarColor } from '../utils/avatar.js'

const ACTIVITY_POLL_INTERVAL_MS = 5000

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
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [liveError, setLiveError] = useState('')
  const [transitioningId, setTransitioningId] = useState(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notifyingHousehold, setNotifyingHousehold] = useState(false)

  // Fetch the household; shared by the initial load and pull-to-refresh.
  const loadRoommates = useCallback(async () => {
    try {
      setRoommates(await getRoommates())
      setError('')
    } catch {
      setError('Could not load roommate statuses.')
    }
  }, [])

  const loadActivities = useCallback(async () => {
    try {
      setActivities(await getActivities())
      setLiveError('')
    } catch {
      setLiveError('Could not load household events.')
    }
  }, [])

  // Load both page-level data sets so the live banner and activity cards share
  // one source of truth from the first render onward.
  useEffect(() => {
    Promise.all([loadRoommates(), loadActivities()]).finally(() => setLoading(false))
  }, [loadActivities, loadRoommates])

  // Keep live-event state current across household devices. Push-enabled open
  // apps refresh immediately from the service worker; visible-page polling and
  // focus refresh cover browsers without notification permission.
  useEffect(() => {
    let pollId = null

    function startPolling() {
      if (pollId !== null || document.visibilityState !== 'visible') return
      pollId = window.setInterval(loadActivities, ACTIVITY_POLL_INTERVAL_MS)
    }

    function stopPolling() {
      if (pollId === null) return
      window.clearInterval(pollId)
      pollId = null
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        loadActivities()
        startPolling()
      } else {
        stopPolling()
      }
    }

    function handleServiceWorkerMessage(event) {
      if (event.data?.type === 'activities-changed') loadActivities()
    }

    startPolling()
    window.addEventListener('focus', loadActivities)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage)

    return () => {
      stopPolling()
      window.removeEventListener('focus', loadActivities)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage)
    }
  }, [loadActivities])

  // Pull down from the top to refresh both household and event state.
  const handleRefresh = useCallback(async () => {
    await Promise.all([loadRoommates(), loadActivities()])
  }, [loadActivities, loadRoommates])

  const { pull, refreshing, threshold } = usePullToRefresh(handleRefresh)

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
  const liveEvent = activities.find((activity) => activity.isLive) ?? null

  async function handleLiveTransition(activity, action) {
    if (transitioningId) return
    setTransitioningId(activity.id)
    setLiveError('')
    try {
      const transition = action === 'start' ? startActivity : endActivity
      setActivities(await transition(activity.id, user.id))
    } catch (err) {
      setLiveError(err.message || `Could not ${action} the event. Try again.`)
    } finally {
      setTransitioningId(null)
    }
  }

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

  async function handleNotifyHousehold() {
    if (notifyingHousehold) return
    setNotifyingHousehold(true)
    setError('')
    try {
      await notifyRoommatesToUpdateStatus(user.id)
    } catch {
      setError('Could not notify the household. Try again.')
    } finally {
      setNotifyingHousehold(false)
    }
  }

  return (
    <>
      {/* Lives off-screen above the top; the pull drags it into view. */}
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} threshold={threshold} />

      <div
        className="mx-auto max-w-[640px] px-[22px] pb-16 pt-10"
        style={{
          // Push the whole page down with the pull so the dots are revealed in
          // the gap above the content rather than overlaying it. A transform
          // here would capture the fixed indicator, which is why it sits outside.
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: pull > 0 && !refreshing ? 'none' : 'transform 260ms ease',
        }}
      >
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
          {liveError && (
            <p className="mt-4 rounded-sm bg-[#fbeae6] px-3 py-2 text-[13.5px] font-semibold text-status-red">
              {liveError}
            </p>
          )}

          {liveEvent && (
            <LiveEventBanner
              event={liveEvent}
              canEnd={liveEvent.proposedById === user.id}
              ending={transitioningId === liveEvent.id}
              onEnd={() => handleLiveTransition(liveEvent, 'end')}
            />
          )}

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

          <div className="mb-3 flex items-center justify-start gap-3">
            <p className="ml-[2px] text-[12.5px] font-bold uppercase tracking-[0.05em] text-ink-soft">
              The household
            </p>
            <button
              type="button"
              onClick={handleNotifyHousehold}
              disabled={notifyingHousehold}
              aria-label="Notify all to update"
              title="Notify all to update"
              className="grid h-9 w-9 flex-none place-items-center rounded-full border border-line bg-accent shadow-soft transition hover:border-[#d9c9b3] hover:bg-accent-deep active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              <img src="/megaphone.png" alt="" className="h-5 w-5 object-contain" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-[14px]">
            {others.map((roommate) => (
              <StatusCard key={roommate.id} roommate={roommate} />
            ))}
          </div>

          <ProposeActivity
            activities={activities}
            onActivitiesChange={setActivities}
            liveEvent={liveEvent}
            transitioningId={transitioningId}
            onLiveTransition={handleLiveTransition}
            roommates={roommates}
          />
        </>
      )}
      </div>
    </>
  )
}

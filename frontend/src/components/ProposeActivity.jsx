import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { getActivities, proposeActivity, notifyActivity } from '../api/client.js'

// Short relative time, e.g. "just now", "5m", "3h", "2d".
function timeAgo(createdAt) {
  const secs = Math.max(0, Math.floor((Date.now() - createdAt) / 1000))
  if (secs < 45) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

// "Propose an activity": a text field + Send button that pushes the proposal to
// everyone, with the most recent proposals listed below (newest nearest the
// input).
// `refreshSignal` is a counter the parent bumps on pull-to-refresh; bumping it
// re-fetches the recent feed without remounting (so a half-typed proposal and
// any inline notify state are preserved).
export default function ProposeActivity({ refreshSignal = 0 }) {
  const { user } = useAuth()
  const [activities, setActivities] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  // Per-activity notify state: the id currently sending, and the id just sent
  // (briefly shown as a confirmation).
  const [notifyingId, setNotifyingId] = useState(null)
  const [sentId, setSentId] = useState(null)

  // Load the recent feed on mount, and again whenever the parent refreshes.
  useEffect(() => {
    let active = true
    getActivities()
      .then((list) => active && setActivities(list))
      .catch(() => {
        /* non-critical: just show an empty feed */
      })
    return () => {
      active = false
    }
  }, [refreshSignal])

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    setError('')
    try {
      const updated = await proposeActivity(trimmed, user.name)
      setActivities(updated)
      setText('')
    } catch {
      setError('Could not send your proposal. Try again.')
    } finally {
      setSending(false)
    }
  }

  // Re-push an existing activity as "<you> emphasized <activity>".
  async function handleNotify(activity) {
    if (notifyingId) return
    setNotifyingId(activity.id)
    setError('')
    try {
      await notifyActivity(activity.id, user.name)
      setSentId(activity.id)
      setTimeout(() => setSentId((cur) => (cur === activity.id ? null : cur)), 2000)
    } catch {
      setError('Could not send the notification. Try again.')
    } finally {
      setNotifyingId(null)
    }
  }

  return (
    <section className="mt-[34px]">
      <p className="mb-3 ml-[2px] text-[12.5px] font-bold uppercase tracking-[0.05em] text-ink-soft">
        Propose an activity
      </p>

      <form onSubmit={handleSubmit} className="flex gap-[10px]">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={280}
          placeholder="Pizza and a movie?"
          className="flex-1 rounded-sm border border-line bg-white px-[14px] py-[12px] text-[14px] text-ink outline-none transition placeholder:text-[#b6a995] focus:border-accent"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="flex-none rounded-sm bg-accent px-[20px] py-[12px] text-[14px] font-bold text-white transition hover:bg-accent-deep disabled:opacity-60"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>

      {error && (
        <p className="mt-2 text-[13px] font-semibold text-status-red">{error}</p>
      )}

      <div className="mt-[14px] space-y-[10px]">
        {activities.length === 0 ? (
          <p className="text-[13.5px] text-ink-soft">
            No activities yet — propose the first one!
          </p>
        ) : (
          activities.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-[10px] rounded-sm border border-line bg-card px-[14px] py-[10px]"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[14px] text-ink">{a.text}</p>
                <p className="mt-[2px] text-[12px] text-ink-soft">
                  {a.proposedBy} · {timeAgo(a.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleNotify(a)}
                disabled={notifyingId === a.id}
                className="flex-none rounded-full border border-[#d6e2c5] bg-[#eef3e7] px-[13px] py-[7px] text-[12.5px] font-bold text-[#50603f] transition hover:brightness-95 disabled:opacity-60"
              >
                {notifyingId === a.id ? 'Sending…' : sentId === a.id ? 'Sent ✓' : '🔔 Notify'}
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

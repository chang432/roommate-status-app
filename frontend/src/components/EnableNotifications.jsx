import { useEffect, useState } from 'react'
import { pushSupported, enablePush } from '../utils/push.js'
import { useAuth } from '../context/AuthContext.jsx'

// Opt this device into push notifications. The actual subscribe runs from the
// tap handler (iOS requires a user gesture). Reflects the current permission so
// the control is informative on repeat visits.
export default function EnableNotifications() {
  const { user } = useAuth()
  const [supported, setSupported] = useState(true)
  const [permission, setPermission] = useState('default')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const available = pushSupported()
    setSupported(available)
    if (!('Notification' in window)) return
    setPermission(Notification.permission)
    // Re-save existing subscriptions so legacy devices become associated with
    // the currently signed-in roommate without another permission prompt.
    if (available && Notification.permission === 'granted') {
      enablePush(user.id, false).catch(() => {
        setError('Could not sync notifications for this roommate.')
      })
    }
  }, [user.id])

  const note = 'mb-[26px] mt-[22px] rounded-md border border-line bg-card px-4 py-[13px] text-[13.5px] text-ink-soft'

  // On iOS, push is unavailable until the app is installed to the Home Screen.
  if (!supported) {
    return (
      <p className={note}>
        Want a nudge when roomies are free? On iPhone, tap Share → <b>Add to Home
        Screen</b>, then open this app from the new icon to enable notifications.
      </p>
    )
  }
  if (permission === 'granted') {
    return (
      <div className={note}>
        <p>🔔 Notifications are on for this device.</p>
        {error && (
          <p className="mt-2 font-semibold text-status-red">{error}</p>
        )}
      </div>
    )
  }
  if (permission === 'denied') {
    return (
      <p className={note}>
        Notifications are blocked. Re-enable them for this app in your
        browser/site settings, then reload.
      </p>
    )
  }

  async function handleClick() {
    setBusy(true)
    setError('')
    try {
      const result = await enablePush(user.id)
      setPermission(result)
      if (result === 'default') setError('Permission dismissed — tap to try again.')
    } catch (err) {
      setError(
        err.message === 'unsupported'
          ? 'This browser can’t do push here.'
          : 'Could not enable notifications. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-[26px] mt-[22px]">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="w-full rounded-md border border-[#d6e2c5] bg-gradient-to-br from-[#eef3e7] to-[#e7efdd] px-4 py-[13px] text-[14px] font-semibold text-[#50603f] transition hover:brightness-[0.98] disabled:opacity-60"
      >
        {busy ? 'Enabling…' : '🔔 Enable notifications on this device'}
      </button>
      {error && (
        <p className="mt-2 text-[13px] font-semibold text-status-red">{error}</p>
      )}
    </div>
  )
}

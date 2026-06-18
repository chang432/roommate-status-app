import { useEffect, useState } from 'react'
import { pushSupported, enablePush } from '../utils/push.js'
import { useAuth } from '../context/AuthContext.jsx'
import { cx } from '../utils/classNames.js'
import styles from './styling/EnableNotifications.module.css'

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

  // On iOS, push is unavailable until the app is installed to the Home Screen.
  if (!supported) {
    return (
      <p className={styles.note}>
        Want a nudge when roomies are free? On iPhone, tap Share → <b>Add to Home
        Screen</b>, then open this app from the new icon to enable notifications.
      </p>
    )
  }
  if (permission === 'granted') {
    return (
      <div className={styles.note}>
        <p>🔔 Notifications are on for this device.</p>
        {error && (
          <p className={styles.inlineError}>{error}</p>
        )}
      </div>
    )
  }
  if (permission === 'denied') {
    return (
      <p className={styles.note}>
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
    <div className={styles.wrap}>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={styles.button}
      >
        {busy ? 'Enabling…' : '🔔 Enable notifications on this device'}
      </button>
      {error && (
        <p className={cx('ui-errorText', styles.error)}>{error}</p>
      )}
    </div>
  )
}

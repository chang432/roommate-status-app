import { useState } from 'react'
import { endJam, shareJam } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import { cx } from '../utils/classNames.js'
import { relativeTime } from '../utils/time.js'
import styles from './styling/JamWidget.module.css'

function Waveform() {
  return (
    <div className={styles.waveform} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  )
}

export function JamShareForm({ currentJam, onJamChange, onSuccess }) {
  const { user } = useAuth()
  const [link, setLink] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    const trimmed = link.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError('')
    try {
      onJamChange(await shareJam(trimmed, user.id))
      setLink('')
      onSuccess?.()
    } catch (err) {
      setError(err.message || 'Could not share that Jam link.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {currentJam ? (
        <p className={styles.formNote}>
          This will replace {currentJam.hostName}&apos;s active Jam.
        </p>
      ) : null}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Spotify Jam link</span>
        <input
          type="url"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="https://spotify.link/..."
          className={cx('ui-textInput', styles.input)}
        />
      </label>
      {error ? <p className={cx('ui-errorText', styles.error)}>{error}</p> : null}
      <div className={styles.formActions}>
        <button
          type="submit"
          disabled={saving || !link.trim()}
          className={cx('ui-primaryButton', styles.shareButton)}
        >
          {saving ? 'Sharing...' : currentJam ? 'Replace Jam' : 'Share Jam'}
        </button>
      </div>
    </form>
  )
}

export default function JamWidget({ jam, onJamChange, onReplace }) {
  const { user } = useAuth()
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState('')
  const isHost = jam?.hostId === user.id

  if (!jam) return null

  async function handleEnd() {
    if (ending) return
    setEnding(true)
    setError('')
    try {
      onJamChange(await endJam(user.id))
    } catch (err) {
      setError(err.message || 'Could not end the Jam.')
    } finally {
      setEnding(false)
    }
  }

  return (
    <section className={styles.wrap} aria-label="Spotify Jam">
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <Waveform />
          <div className={styles.titleText}>
            <p className={styles.eyebrow}>Spotify Jam</p>
            <h2 className={styles.title}>{jam.hostName}&apos;s Jam is live</h2>
            <p className={styles.meta}>Shared {relativeTime(jam.createdAt)}</p>
          </div>
        </div>
        <a
          href={jam.link}
          target="_blank"
          rel="noreferrer"
          className={cx('ui-primaryButton', styles.joinButton)}
        >
          Join Jam
        </a>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          onClick={onReplace}
          className={cx('ui-pillButton ui-pillSecondary', styles.controlButton)}
        >
          Replace Jam
        </button>
        {isHost && (
          <button
            type="button"
            onClick={handleEnd}
            disabled={ending}
            className={cx('ui-pillButton ui-pillDangerSoft', styles.controlButton)}
          >
            {ending ? 'Ending...' : 'End Jam'}
          </button>
        )}
      </div>

      {error ? <p className={cx('ui-errorText', styles.error)}>{error}</p> : null}
    </section>
  )
}

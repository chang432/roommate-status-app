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

function JoinIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

function ReplaceIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7h13" />
      <path d="m13 3 4 4-4 4" />
      <path d="M21 17H8" />
      <path d="m11 13-4 4 4 4" />
    </svg>
  )
}

function EndIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </svg>
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

export default function JamWidget({ jam, onJamChange, onReplace, moduleTag }) {
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
      <div className={styles.row}>
        <div className={styles.titleBlock}>
          <Waveform />
          <div className={styles.titleText}>
            <div className={styles.titleRow}>
              <p className={styles.eyebrow}>Spotify Jam</p>
              {moduleTag}
            </div>
            <h2 className={styles.title}>{jam.hostName}&apos;s Jam is live</h2>
            <p className={styles.meta}>Shared {relativeTime(jam.createdAt)}</p>
          </div>
        </div>

        <div className={styles.controls}>
          {!isHost && (
            <a
              href={jam.link}
              target="_blank"
              rel="noreferrer"
              aria-label="Join Jam"
              title="Join Jam"
              className={styles.joinButton}
            >
              <JoinIcon />
            </a>
          )}
          <button
            type="button"
            onClick={onReplace}
            aria-label="Replace Jam"
            title="Replace Jam"
            className={styles.replaceButton}
          >
            <ReplaceIcon />
          </button>
        {isHost && (
          <button
            type="button"
            onClick={handleEnd}
            disabled={ending}
            aria-label="End Jam"
            title="End Jam"
            className={styles.endButton}
          >
            <EndIcon />
          </button>
        )}
        </div>
      </div>

      {error ? <p className={cx('ui-errorText', styles.error)}>{error}</p> : null}
    </section>
  )
}

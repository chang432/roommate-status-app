import { useEffect, useState } from 'react'
import StatusDot from './StatusDot.jsx'
import StatusTimestamp from './StatusTimestamp.jsx'
import { statusLabel, statusNote } from '../utils/status.js'
import { cx } from '../utils/classNames.js'
import styles from './styling/StatusModal.module.css'

// Centered popup showing a roommate's full status — used when a compact card
// truncates a long supplemental note. Closes on backdrop click, the top-right
// close button, or Escape.
export default function StatusModal({ roommate, onPoke, onClose }) {
  const [poking, setPoking] = useState(false)
  const [pokeResult, setPokeResult] = useState('')

  // Allow Escape to dismiss, like a standard dialog.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const note = statusNote(roommate)

  async function handlePoke() {
    if (poking) return
    setPoking(true)
    setPokeResult('')
    try {
      await onPoke(roommate.id)
      setPokeResult('Poked!')
    } catch (error) {
      setPokeResult(error.message || 'Could not poke this roommate.')
    } finally {
      setPoking(false)
    }
  }

  return (
    // Backdrop: clicking it closes; clicks inside the dialog are stopped below.
    <div onClick={onClose} className={styles.backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={styles.dialog}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={styles.closeButton}
        >
          ×
        </button>
        <div className={styles.titleRow}>
          <StatusDot status={roommate.status} />
          <span className={styles.name}>{roommate.name}</span>
        </div>
        <div className={styles.status}>{statusLabel(roommate)}</div>
        {/* Full note, wrapped and never truncated. */}
        {note ? (
          <p className={styles.note}>
            {note}
          </p>
        ) : (
          <p className={styles.emptyNote}>No extra note.</p>
        )}
        <StatusTimestamp
          timestamp={roommate.statusUpdatedAt}
          className={styles.timestamp}
        />
        {pokeResult && (
          <p className={styles.pokeResult} role="status">
            {pokeResult}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            onClick={handlePoke}
            disabled={poking || pokeResult === 'Poked!'}
            className={cx('ui-primaryButton', styles.actionButton)}
          >
            {poking ? 'Poking…' : pokeResult === 'Poked!' ? 'Poked!' : '👉 Poke'}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import ModalShell from './ModalShell.jsx'
import StatusDot from './StatusDot.jsx'
import StatusTimestamp from './StatusTimestamp.jsx'
import { statusLabel, statusNote } from '../utils/status.js'
import { cx } from '../utils/classNames.js'
import styles from './styling/StatusModal.module.css'

// Centered popup showing a roommate's full status — used when a compact card
// truncates a long supplemental note. Closes on backdrop click, the top-right
// close button, or Escape.
export default function StatusModal({ roommate, pokeCount, onPoke, onClose }) {
  const [poking, setPoking] = useState(false)
  const [pokeError, setPokeError] = useState('')

  const note = statusNote(roommate)

  async function handlePoke() {
    if (poking) return
    setPoking(true)
    setPokeError('')
    try {
      await onPoke(roommate.id)
    } catch (error) {
      setPokeError(error.message || 'Could not poke this roommate.')
    } finally {
      setPoking(false)
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      ariaLabel={`${roommate.name} status details`}
      widthClassName={styles.dialog}
      contentClassName={styles.content}
    >
      <>
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
        {pokeCount > 0 && (
          <p className={styles.pokeResult} role="status">
            {pokeCount === 1 ? 'Poked once' : `Poked ${pokeCount} times`}
          </p>
        )}
        {pokeError && (
          <p className={styles.pokeError} role="alert">
            {pokeError}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            onClick={handlePoke}
            disabled={poking}
            className={cx('ui-primaryButton', styles.actionButton)}
          >
            {poking ? 'Poking…' : '👉 Poke'}
          </button>
        </div>
      </>
    </ModalShell>
  )
}

import { useEffect, useRef, useState } from 'react'
import StatusDot from './StatusDot.jsx'
import StatusModal from './StatusModal.jsx'
import StatusTimestamp from './StatusTimestamp.jsx'
import { statusLabel, statusNote } from '../../utils/status.js'
import { cx } from '../../utils/classNames.js'
import styles from './StatusCard.module.css'

// Compact card for a household member (everyone other than "you"). The note can
// be truncated here, so clicking the card opens a popup with the full status.
export default function StatusCard({ roommate, onPoke }) {
  const [open, setOpen] = useState(false)
  const [pokeCount, setPokeCount] = useState(0)
  const pokeResetTimer = useRef(null)
  const note = statusNote(roommate)

  useEffect(() => {
    return () => window.clearTimeout(pokeResetTimer.current)
  }, [])

  async function handlePoke(roommateId) {
    await onPoke(roommateId)
    setPokeCount((count) => count + 1)

    // The counter represents one burst of pokes, ending 30 seconds after the
    // most recent successful delivery.
    window.clearTimeout(pokeResetTimer.current)
    pokeResetTimer.current = window.setTimeout(() => setPokeCount(0), 30000)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={styles.card}
      >
        <div className={styles.body}>
          <div className={styles.titleRow}>
            <StatusDot status={roommate.status} />
            <span className={styles.name}>{roommate.name}</span>
          </div>
          <div className={cx('ui-truncate', styles.status)}>
            {statusLabel(roommate)}
          </div>
          {/* Supplemental note the roommate attached to their status, if any. */}
          {note && (
            <div className={cx('ui-truncate', styles.note)}>
              {note}
            </div>
          )}
          <StatusTimestamp
            timestamp={roommate.statusUpdatedAt}
            className={styles.timestamp}
          />
        </div>
      </button>
      {open && (
        <StatusModal
          roommate={roommate}
          pokeCount={pokeCount}
          onPoke={handlePoke}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

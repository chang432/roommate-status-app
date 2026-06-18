import { useEffect } from 'react'
import StatusDot from './StatusDot.jsx'
import StatusTimestamp from './StatusTimestamp.jsx'
import { statusLabel, statusNote } from '../utils/status.js'
import { cx } from '../utils/classNames.js'
import styles from './StatusModal.module.css'

// Centered popup showing a roommate's full status — used when a compact card
// truncates a long supplemental note. Closes on backdrop click, the Close
// button, or Escape.
export default function StatusModal({ roommate, onClose }) {
  // Allow Escape to dismiss, like a standard dialog.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const note = statusNote(roommate)

  return (
    // Backdrop: clicking it closes; clicks inside the dialog are stopped below.
    <div onClick={onClose} className={styles.backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={styles.dialog}
      >
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
        <button
          type="button"
          onClick={onClose}
          className={cx('ui-primaryButton', styles.closeButton)}
        >
          Close
        </button>
      </div>
    </div>
  )
}

import Avatar from './Avatar.jsx'
import StatusDot from './StatusDot.jsx'
import StatusTimestamp from './StatusTimestamp.jsx'
import { statusLabel, statusNote } from '../utils/status.js'
import styles from './styling/YouCard.module.css'

// The signed-in roommate's own card: highlighted, full-width, with an Edit
// button that opens the status editor.
export default function YouCard({ roommate, avatarColor, onEdit }) {
  const note = statusNote(roommate)
  return (
    <div className={styles.card}>
      <Avatar name={roommate.name} color={avatarColor} size={56} />
      <div className={styles.body}>
        <div className={styles.titleRow}>
          <StatusDot status={roommate.status} />
          <span className={styles.name}>{roommate.name}</span>
          <span className={styles.youBadge}>
            You
          </span>
        </div>
        <div className={styles.status}>{statusLabel(roommate)}</div>
        {/* Supplemental note attached to your current status, if any. */}
        {note && <div className={styles.note}>{note}</div>}
        <StatusTimestamp
          timestamp={roommate.statusUpdatedAt}
          className={styles.timestamp}
        />
      </div>
      <button
        type="button"
        onClick={onEdit}
        className={styles.editButton}
      >
        Edit status
      </button>
    </div>
  )
}

import { useEffect, useState } from 'react'
import Avatar from './Avatar.jsx'
import StatusDot from './StatusDot.jsx'
import StatusTimestamp from './StatusTimestamp.jsx'
import { STATUS_LABEL, STATUS_ORDER, statusLabel, statusNote } from '../utils/status.js'
import { cx } from '../utils/classNames.js'
import styles from './styling/YouCard.module.css'

// The signed-in roommate's own card: highlighted, full-width, with an Edit
// button that opens the status editor.
export default function YouCard({
  roommate,
  avatarColor,
  editing,
  saving,
  onEdit,
  onSave,
  onCancel,
}) {
  const note = statusNote(roommate)
  const [status, setStatus] = useState(roommate.status)
  const [draftNote, setDraftNote] = useState(roommate.statusText || '')

  useEffect(() => {
    if (!editing) return
    setStatus(roommate.status)
    setDraftNote(roommate.statusText || '')
  }, [editing, roommate.status, roommate.statusText])

  function handleSubmit(event) {
    event.preventDefault()
    onSave(status, draftNote.trim())
  }

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
        {editing ? 'Close' : 'Edit status'}
      </button>
      {editing && (
        <form className={styles.editor} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              disabled={saving}
              className={cx('ui-textInput', styles.select)}
            >
              {STATUS_ORDER.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Note</span>
            <input
              type="text"
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
              disabled={saving}
              placeholder="Add a note (optional)…"
              className={cx('ui-textInput', styles.noteInput)}
            />
          </label>
          <div className={styles.editorActions}>
            <button
              type="submit"
              disabled={saving}
              className={cx('ui-primaryButton', styles.saveButton)}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className={cx('ui-secondaryButton', styles.cancelButton)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

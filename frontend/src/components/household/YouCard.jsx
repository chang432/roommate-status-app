import { useEffect, useState } from 'react'
import Avatar from '../ui/Avatar.jsx'
import StatusDot from './StatusDot.jsx'
import StatusTimestamp from './StatusTimestamp.jsx'
import { STATUS_LABEL, STATUS_ORDER, statusLabel, statusNote } from '../../utils/status.js'
import { cx } from '../../utils/classNames.js'
import styles from './YouCard.module.css'

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
  const editableStatus = roommate.baseStatus ?? roommate.status
  const editableNote = roommate.baseStatusText ?? roommate.statusText ?? ''
  const [status, setStatus] = useState(editableStatus)
  const [draftNote, setDraftNote] = useState(editableNote)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)

  useEffect(() => {
    if (!editing) return
    setStatus(editableStatus)
    setDraftNote(editableNote)
    setStatusMenuOpen(false)
  }, [editableNote, editableStatus, editing])

  function handleSubmit(event) {
    event.preventDefault()
    onSave(status, draftNote.trim())
  }

  function selectStatus(value) {
    if (value !== status) {
      setDraftNote('')
    }
    setStatus(value)
    setStatusMenuOpen(false)
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
          <div
            className={styles.field}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setStatusMenuOpen(false)
              }
            }}
          >
            <span className={styles.fieldLabel}>Status</span>
            <div className={styles.statusSelect}>
              <button
                type="button"
                onClick={() => setStatusMenuOpen((open) => !open)}
                aria-haspopup="listbox"
                aria-expanded={statusMenuOpen}
                disabled={saving}
                className={cx(
                  'ui-textInput',
                  styles.statusSelectButton,
                  statusMenuOpen ? styles.statusSelectButtonOpen : '',
                )}
              >
                <span className={styles.statusSelectValue}>
                  <StatusDot status={status} />
                  <span>{STATUS_LABEL[status]}</span>
                </span>
                <span className={styles.statusSelectArrow}>▾</span>
              </button>
              {statusMenuOpen && (
                <div className={styles.statusMenu} role="listbox">
                  {STATUS_ORDER.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="option"
                      aria-selected={status === value}
                      onClick={() => selectStatus(value)}
                      className={cx(
                        styles.statusOption,
                        status === value ? styles.statusOptionSelected : '',
                      )}
                    >
                      <StatusDot status={value} />
                      <span>{STATUS_LABEL[value]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
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
          {roommate.isActivityStatus && (
            <p className={styles.editorHint}>
              This card is currently showing an activity-based status.
            </p>
          )}
        </form>
      )}
    </div>
  )
}

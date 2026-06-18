import { useState } from 'react'
import StatusDot from './StatusDot.jsx'
import { STATUS_ORDER, STATUS_LABEL } from '../utils/status.js'
import { cx } from '../utils/classNames.js'
import styles from './styling/EditPanel.module.css'

// Editor for your own status. Pick one of the fixed statuses and, below each
// title, optionally add a supplemental note for that status. Only the selected
// status's note is saved and shown to everyone. Notes are tracked per status so
// switching between options is non-destructive until "Save" is pressed.
export default function EditPanel({ roommate, onSave, onCancel, saving }) {
  const [status, setStatus] = useState(roommate.status)
  // Map of status -> note text. Only the currently-saved status has stored
  // text, so seed just that slot; every other field starts empty.
  const [notes, setNotes] = useState(() => ({
    [roommate.status]: roommate.statusText || '',
  }))

  function setNote(value) {
    setNotes((prev) => ({ ...prev, [status]: value }))
  }

  function handleSave() {
    // Persist the note belonging to the selected status (others are discarded).
    onSave(status, (notes[status] || '').trim())
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>Set your status</h3>

      {STATUS_ORDER.map((value) => (
        <div
          key={value}
          className={cx(
            styles.option,
            status === value ? styles.optionSelected : styles.optionIdle,
          )}
        >
          <button
            type="button"
            onClick={() => setStatus(value)}
            className={styles.optionButton}
          >
            <StatusDot status={value} /> {STATUS_LABEL[value]}
          </button>
          <input
            type="text"
            value={notes[value] || ''}
            onChange={(e) => setNote(e.target.value)}
            // Typing in a field selects that status so the note you write is the
            // one that gets saved.
            onFocus={() => setStatus(value)}
            placeholder="Add a note (optional)…"
            className={cx('ui-textInput', styles.noteInput)}
          />
        </div>
      ))}

      <div className={styles.actions}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={cx('ui-primaryButton', styles.saveButton)}
        >
          {saving ? 'Saving…' : 'Save status'}
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
    </div>
  )
}

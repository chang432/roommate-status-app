import { useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { createRequest } from '../../api/client.js'
import { cx } from '../../utils/classNames.js'
import styles from './RequestCreateForm.module.css'

export function RoommateChecklist({ roommates, selectedIds, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const allSelected =
    roommates.length > 0 && selectedIds.length === roommates.length
  const selectedNames = roommates
    .filter((roommate) => selectedIds.includes(roommate.id))
    .map((roommate) => roommate.name)

  function toggleAll() {
    onChange(allSelected ? [] : roommates.map((roommate) => roommate.id))
  }

  function toggleOne(id) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id],
    )
  }

  return (
    <div
      className={cx(
        styles.recipientSelect,
        open ? styles.recipientSelectOpen : '',
      )}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        className={cx('ui-textInput', styles.recipientButton)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className={styles.recipientButtonText}>
          {selectedNames.length ? selectedNames.join(', ') : 'Choose roommates'}
        </span>
        <span className={styles.recipientArrow}>▾</span>
      </button>
      {open ? (
        <div className={styles.recipientMenu}>
          <label className={styles.recipientOption}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className={styles.checkbox}
            />
            <span>All roommates</span>
          </label>
          {roommates.map((roommate) => (
            <label key={roommate.id} className={styles.recipientOption}>
              <input
                type="checkbox"
                checked={selectedIds.includes(roommate.id)}
                onChange={() => toggleOne(roommate.id)}
                className={styles.checkbox}
              />
              <span>{roommate.name}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function RequestCreateForm({
  roommates,
  onRequestsChange,
  onSuccess,
  onCancel,
}) {
  const { user } = useAuth()
  const requestableRoommates = useMemo(
    () => roommates.filter((roommate) => roommate.id !== user.id),
    [roommates, user.id],
  )
  const [text, setText] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || selectedIds.length === 0 || sending) return
    setSending(true)
    setError('')
    try {
      const updated = await createRequest(trimmed, user.id, selectedIds)
      onRequestsChange(updated)
      onSuccess?.()
    } catch {
      setError('Could not send your request. Try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Request</span>
          <input
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={280}
            placeholder="Can someone feed the beasts?"
            className={cx('ui-textInput', styles.input)}
          />
        </label>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Roommates</span>
          <RoommateChecklist
            roommates={requestableRoommates}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
            disabled={sending}
          />
        </div>
      </div>

      {error ? <p className={cx('ui-errorText', styles.error)}>{error}</p> : null}

      <div className={styles.actions}>
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          className={cx('ui-secondaryButton', styles.actionButton)}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={sending || !text.trim() || selectedIds.length === 0}
          className={cx('ui-primaryButton', styles.actionButton)}
        >
          {sending ? 'Sending…' : 'Create request'}
        </button>
      </div>
    </form>
  )
}

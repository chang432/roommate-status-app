import { useState } from 'react'
import { updateModule } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import { MODULE_DEFINITIONS } from '../models/modules.js'
import { cx } from '../utils/classNames.js'
import { fromDateTimeLocal, toDateTimeLocal } from '../utils/time.js'
import { RoommateChecklist } from './RequestCreateForm.jsx'
import styles from './styling/ModuleEditForm.module.css'

export default function ModuleEditForm({ module, roommates, onSaved, onCancel }) {
  const { user } = useAuth()
  const payload = module.payload
  const editDefinition = MODULE_DEFINITIONS[module.type].edit
  const field = editDefinition.field
  const [value, setValue] = useState(payload[field] ?? '')
  const [selectedIds, setSelectedIds] = useState(payload.requestedIds ?? [])
  const [startTime, setStartTime] = useState(toDateTimeLocal(payload.startAt))
  const [endTime, setEndTime] = useState(toDateTimeLocal(payload.endAt))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const requestableRoommates = roommates.filter((roommate) => roommate.id !== user.id)

  async function handleSubmit(event) {
    event.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || saving) return
    if (editDefinition.recipients && selectedIds.length === 0) return
    if (endTime && !startTime) {
      setError('Choose a start time before an end time.')
      return
    }
    if (
      startTime &&
      endTime &&
      fromDateTimeLocal(endTime) <= fromDateTimeLocal(startTime)
    ) {
      setError('End time must be later than start time.')
      return
    }

    const changes = { [field]: trimmed }
    if (editDefinition.recipients) changes.requestedIds = selectedIds
    if (editDefinition.schedule && !payload.isLive) {
      changes.startAt = fromDateTimeLocal(startTime)
      changes.endAt = fromDateTimeLocal(endTime)
    }

    setSaving(true)
    setError('')
    try {
      await updateModule(module.type, module.id, user.id, changes)
      await onSaved()
    } catch (err) {
      setError(err.message || 'Could not save this module. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{editDefinition.fieldLabel}</span>
        <input
          type={editDefinition.inputType ?? 'text'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={editDefinition.inputType === 'url' ? undefined : 280}
          className={cx('ui-textInput', styles.input)}
          autoFocus
        />
      </label>

      {editDefinition.recipients ? (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Roommates</span>
          <RoommateChecklist
            roommates={requestableRoommates}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
            disabled={saving}
          />
        </div>
      ) : null}

      {editDefinition.schedule && !payload.isLive ? (
        <div className={styles.timeFields}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Start (optional)</span>
            <input
              type="datetime-local"
              step="60"
              value={startTime}
              onChange={(event) => {
                setStartTime(event.target.value)
                if (!event.target.value) setEndTime('')
              }}
              className={cx('ui-textInput', styles.input)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>End (optional)</span>
            <input
              type="datetime-local"
              step="60"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              disabled={!startTime}
              className={cx('ui-textInput', styles.input)}
            />
          </label>
        </div>
      ) : null}

      {error ? <p className={cx('ui-errorText', styles.error)}>{error}</p> : null}
      <div className={styles.actions}>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className={cx('ui-secondaryButton', styles.actionButton)}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !value.trim() || (editDefinition.recipients && !selectedIds.length)}
          className={cx('ui-primaryButton', styles.actionButton)}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}

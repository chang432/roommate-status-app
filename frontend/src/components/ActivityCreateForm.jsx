import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { proposeActivity } from '../api/client.js'
import { fromDateTimeLocal } from '../utils/time.js'
import { cx } from '../utils/classNames.js'
import styles from './styling/ActivityCreateForm.module.css'

function validateTimes(startValue, endValue) {
  if (endValue && !startValue) return 'Choose a start time before an end time.'
  if (
    startValue &&
    endValue &&
    fromDateTimeLocal(endValue) <= fromDateTimeLocal(startValue)
  ) {
    return 'End time must be later than start time.'
  }
  return ''
}

export default function ActivityCreateForm({
  onActivitiesChange,
  onSuccess,
  onCancel,
}) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    const trimmed = text.trim()
    const timeError = validateTimes(startTime, endTime)
    if (timeError) {
      setError(timeError)
      return
    }
    if (!trimmed || sending) return
    setSending(true)
    setError('')
    try {
      const updated = await proposeActivity(
        trimmed,
        user.id,
        fromDateTimeLocal(startTime),
        fromDateTimeLocal(endTime),
      )
      onActivitiesChange(updated)
      onSuccess?.()
    } catch (err) {
      setError(err.message || 'Could not send your proposal. Try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Activity</span>
          <input
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={280}
            placeholder="Rod D and Monopoly Deal?"
            className={cx('ui-textInput', styles.input)}
          />
        </label>
        <div className={styles.timeFields}>
          <label className={styles.timeField}>
            <span className={styles.fieldLabel}>Start (optional)</span>
            <input
              type="datetime-local"
              step="60"
              value={startTime}
              onChange={(event) => {
                setStartTime(event.target.value)
                if (!event.target.value) setEndTime('')
              }}
              className={cx('ui-textInput', styles.timeInput)}
            />
          </label>
          <label className={styles.timeField}>
            <span className={styles.fieldLabel}>End (optional)</span>
            <input
              type="datetime-local"
              step="60"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              disabled={!startTime}
              className={cx('ui-textInput', styles.timeInput)}
            />
          </label>
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
          disabled={sending || !text.trim()}
          className={cx('ui-primaryButton', styles.actionButton)}
        >
          {sending ? 'Sending…' : 'Create activity'}
        </button>
      </div>
    </form>
  )
}

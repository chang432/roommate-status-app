// Format epoch-millisecond timestamps consistently across status and activity
// views. Future timestamps are treated as "just now" to tolerate clock skew.
export function relativeTime(timestamp) {
  const value = Number(timestamp)
  if (!Number.isFinite(value)) return ''

  const secs = Math.max(0, Math.floor((Date.now() - value) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function exactDateTime(timestamp) {
  const date = new Date(Number(timestamp))
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString([], {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
}

export function toDateTimeLocal(timestamp) {
  if (timestamp === null || timestamp === undefined) return ''
  const date = new Date(Number(timestamp))
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function fromDateTimeLocal(value) {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

export function activityTimeLabel(activity) {
  if (activity.startAt === null || activity.startAt === undefined) return ''
  const start = exactDateTime(activity.startAt)
  return activity.endAt ? `${start} – ${exactDateTime(activity.endAt)}` : start
}

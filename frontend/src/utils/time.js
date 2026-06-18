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
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

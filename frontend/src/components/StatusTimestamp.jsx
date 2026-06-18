import { exactDateTime, relativeTime } from '../utils/time.js'

// Shared timestamp presentation for status cards and the expanded status modal.
export default function StatusTimestamp({ timestamp, className = '' }) {
  if (timestamp == null) return null

  const relative = relativeTime(timestamp)
  const exact = exactDateTime(timestamp)
  if (!relative) return null

  return (
    <div className={className} title={exact || undefined}>
      Updated {relative}
    </div>
  )
}

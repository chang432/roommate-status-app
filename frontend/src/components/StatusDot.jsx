import { STATUS_DOT_CLASS } from '../utils/status.js'

// Small colored dot indicating a roommate's status.
export default function StatusDot({ status, className = '' }) {
  return (
    <span
      className={`h-[13px] w-[13px] flex-none rounded-full ${STATUS_DOT_CLASS[status] ?? 'bg-ink-soft'} ${className}`}
    />
  )
}

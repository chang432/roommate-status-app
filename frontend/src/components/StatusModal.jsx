import { useEffect } from 'react'
import StatusDot from './StatusDot.jsx'
import { statusLabel, statusNote } from '../utils/status.js'

// Centered popup showing a roommate's full status — used when a compact card
// truncates a long supplemental note. Closes on backdrop click, the Close
// button, or Escape.
export default function StatusModal({ roommate, onClose }) {
  // Allow Escape to dismiss, like a standard dialog.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const note = statusNote(roommate)

  return (
    // Backdrop: clicking it closes; clicks inside the dialog are stopped below.
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-5"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[400px] rounded-md border border-line bg-card p-6 shadow-card"
      >
        <div className="flex items-center gap-[9px]">
          <StatusDot status={roommate.status} />
          <span className="text-[18px] font-bold text-ink">{roommate.name}</span>
        </div>
        <div className="mt-[6px] text-[14.5px] text-ink-soft">{statusLabel(roommate)}</div>
        {/* Full note, wrapped and never truncated. */}
        {note ? (
          <p className="mt-[12px] whitespace-pre-wrap break-words text-[15px] leading-[1.5] text-ink">
            {note}
          </p>
        ) : (
          <p className="mt-[12px] text-[14px] italic text-ink-soft">No extra note.</p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-[20px] w-full rounded-sm bg-accent py-[12px] text-[14px] font-bold text-white transition hover:bg-accent-deep"
        >
          Close
        </button>
      </div>
    </div>
  )
}

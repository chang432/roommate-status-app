import { useState } from 'react'
import StatusDot from './StatusDot.jsx'
import StatusModal from './StatusModal.jsx'
import StatusTimestamp from './StatusTimestamp.jsx'
import { statusLabel, statusNote } from '../utils/status.js'

// Compact card for a household member (everyone other than "you"). The note can
// be truncated here, so clicking the card opens a popup with the full status.
export default function StatusCard({ roommate }) {
  const [open, setOpen] = useState(false)
  const note = statusNote(roommate)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-[13px] rounded-md border border-line bg-card p-[18px] text-left shadow-soft transition hover:border-[#d9c9b3] active:translate-y-px"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-[9px]">
            <StatusDot status={roommate.status} />
            <span className="text-[15.5px] font-bold text-ink">{roommate.name}</span>
          </div>
          <div className="mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] text-ink-soft">
            {statusLabel(roommate)}
          </div>
          {/* Supplemental note the roommate attached to their status, if any. */}
          {note && (
            <div className="mt-[2px] overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-ink">
              {note}
            </div>
          )}
          <StatusTimestamp
            timestamp={roommate.statusUpdatedAt}
            className="mt-[4px] text-[11.5px] text-ink-soft"
          />
        </div>
      </button>
      {open && <StatusModal roommate={roommate} onClose={() => setOpen(false)} />}
    </>
  )
}

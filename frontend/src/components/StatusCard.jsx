import StatusDot from './StatusDot.jsx'
import { statusLabel, statusNote } from '../utils/status.js'

// Compact card for a household member (everyone other than "you").
export default function StatusCard({ roommate }) {
  const note = statusNote(roommate)
  return (
    <div className="flex items-center gap-[13px] rounded-md border border-line bg-card p-[18px] shadow-soft">
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
      </div>
    </div>
  )
}

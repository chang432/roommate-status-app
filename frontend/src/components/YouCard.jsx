import Avatar from './Avatar.jsx'
import StatusDot from './StatusDot.jsx'
import StatusTimestamp from './StatusTimestamp.jsx'
import { statusLabel, statusNote } from '../utils/status.js'

// The signed-in roommate's own card: highlighted, full-width, with an Edit
// button that opens the status editor.
export default function YouCard({ roommate, avatarColor, onEdit }) {
  const note = statusNote(roommate)
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border-[1.5px] border-[#ecc9b6] bg-gradient-to-br from-card to-accent-soft p-[22px] shadow-card">
      <Avatar name={roommate.name} color={avatarColor} size={56} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[9px]">
          <StatusDot status={roommate.status} />
          <span className="text-[18px] font-bold text-ink">{roommate.name}</span>
          <span className="rounded-full border border-[#ecc9b6] bg-white px-2 py-[2px] text-[11px] font-bold uppercase tracking-[0.05em] text-accent-deep">
            You
          </span>
        </div>
        <div className="mt-[3px] text-[14.5px] text-ink-soft">{statusLabel(roommate)}</div>
        {/* Supplemental note attached to your current status, if any. */}
        {note && <div className="mt-[2px] text-[14px] text-ink">{note}</div>}
        <StatusTimestamp
          timestamp={roommate.statusUpdatedAt}
          className="mt-[4px] text-[12px] text-ink-soft"
        />
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="flex-none rounded-full border-[1.5px] border-[#e6c2ad] bg-white px-4 py-[9px] text-[14px] font-bold text-accent-deep transition hover:bg-[#fff3ec] active:translate-y-px max-[520px]:w-full"
      >
        Edit status
      </button>
    </div>
  )
}

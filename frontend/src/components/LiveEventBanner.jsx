import { relativeTime } from '../utils/time.js'

export default function LiveEventBanner({ event, canEnd, ending, onEnd }) {
  return (
    <div className="mb-[26px] mt-[22px] rounded-md border border-[#e8b9ae] bg-gradient-to-br from-[#fff0ec] to-[#fbe2dc] px-4 py-[14px] text-[#713c32] shadow-sm">
      <div className="flex items-center gap-[12px]">
        <span className="h-[10px] w-[10px] flex-none animate-pulse rounded-full bg-status-red" />
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.08em]">Live now</p>
          <p className="mt-[2px] truncate text-[16px] font-bold text-ink">{event.text}</p>
          <p className="mt-[2px] text-[12px] text-ink-soft">
            Started by {event.proposedBy}
            {event.liveStartedAt ? ` · ${relativeTime(event.liveStartedAt)}` : ''}
          </p>
        </div>
        {canEnd && (
          <button
            type="button"
            onClick={onEnd}
            disabled={ending}
            className="flex-none rounded-full border border-status-red bg-status-red px-[14px] py-[8px] text-[12.5px] font-bold text-white transition hover:brightness-95 disabled:opacity-60"
          >
            {ending ? 'Ending…' : 'End event'}
          </button>
        )}
      </div>
    </div>
  )
}

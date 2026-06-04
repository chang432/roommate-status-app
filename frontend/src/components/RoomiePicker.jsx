import Avatar from './Avatar.jsx'
import { avatarColor } from '../utils/avatar.js'

// Horizontal, swipeable list of roommates on the login screen. Tap a card to
// select who's signing in. Soft edge fades hint that the row scrolls.
export default function RoomiePicker({ roommates, selectedId, onSelect }) {
  return (
    <div className="relative mb-6">
      <span className="mb-[10px] ml-[2px] block text-[12.5px] font-bold uppercase tracking-[0.04em] text-ink-soft">
        Who&apos;s logging in?
      </span>

      <div className="no-scrollbar flex gap-3 overflow-x-auto px-[2px] pb-[14px] pt-[6px]">
        {roommates.map((roommate, index) => {
          const selected = roommate.id === selectedId
          return (
            <button
              key={roommate.id}
              type="button"
              onClick={() => onSelect(roommate)}
              className={`w-[92px] flex-none rounded-md border-[1.5px] px-[10px] pb-3 pt-[14px] text-center transition hover:-translate-y-[2px] ${
                selected
                  ? 'border-accent bg-accent-soft -translate-y-[2px] shadow-soft'
                  : 'border-line bg-white'
              }`}
            >
              <Avatar
                name={roommate.name}
                color={avatarColor(index)}
                size={46}
                className="mx-auto mb-[9px]"
              />
              <span className="text-[13.5px] font-semibold text-ink">{roommate.name}</span>
            </button>
          )
        })}
      </div>

      {/* Edge fades to hint horizontal scrollability */}
      <div className="pointer-events-none absolute bottom-[14px] left-0 top-0 w-[26px] bg-gradient-to-r from-card to-transparent" />
      <div className="pointer-events-none absolute bottom-[14px] right-0 top-0 w-[26px] bg-gradient-to-l from-card to-transparent" />
    </div>
  )
}

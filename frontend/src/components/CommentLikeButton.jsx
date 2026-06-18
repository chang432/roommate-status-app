import { useEffect, useId, useRef } from 'react'
import Avatar from './Avatar.jsx'
import { avatarColor } from '../utils/avatar.js'

export default function CommentLikeButton({
  count,
  liked,
  ownComment,
  busy,
  onToggle,
  likedByIds,
  roommates,
  open,
  onOpenChange,
}) {
  const rootRef = useRef(null)
  const popoverRef = useRef(null)
  const onOpenChangeRef = useRef(onOpenChange)
  const popoverId = useId()
  onOpenChangeRef.current = onOpenChange
  const likers = likedByIds
    .map((id) => {
      const index = roommates.findIndex((roommate) => roommate.id === id)
      return index === -1 ? null : { ...roommates[index], color: avatarColor(index) }
    })
    .filter(Boolean)

  useEffect(() => {
    if (!open) return undefined

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) onOpenChangeRef.current(false)
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') onOpenChangeRef.current(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    popoverRef.current?.focus()
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (open && count === 0) onOpenChangeRef.current(false)
  }, [count, open])

  return (
    <span ref={rootRef} className="relative inline-flex">
      <span
        className={`inline-flex overflow-hidden rounded-full text-[11px] font-semibold ${
          liked ? 'bg-[#fbeae6] text-status-red' : 'bg-[#f5f0e8] text-ink-soft'
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          disabled={ownComment || busy}
          aria-pressed={liked}
          aria-label={liked ? 'Unlike comment' : 'Like comment'}
          title={ownComment ? 'You cannot like your own comment' : undefined}
          className="px-2 py-1 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span aria-hidden="true">{liked ? '♥' : '♡'}</span>
        </button>
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          disabled={count === 0}
          aria-expanded={open}
          aria-controls={count > 0 ? popoverId : undefined}
          aria-label={`View ${count} ${count === 1 ? 'person' : 'people'} who liked this comment`}
          className="border-l border-black/10 px-2 py-1 transition hover:bg-black/5 disabled:cursor-default disabled:opacity-60"
        >
          {count}
        </button>
      </span>

      {open && (
        <span
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-label="People who liked this comment"
          tabIndex={-1}
          className="absolute right-0 top-full z-30 mt-1 max-h-[240px] w-max min-w-[170px] max-w-[min(260px,calc(100vw-48px))] overflow-y-auto rounded-sm border border-line bg-white p-2 shadow-card outline-none"
        >
          <span className="mb-1 block px-1 text-[10px] font-bold uppercase tracking-[0.06em] text-ink-soft">
            Liked by
          </span>
          <span className="block space-y-1">
            {likers.length > 0 ? (
              likers.map((roommate) => (
                <span
                  key={roommate.id}
                  className="flex items-center gap-2 rounded-sm px-1 py-1 text-[12px] text-ink"
                >
                  <Avatar name={roommate.name} color={roommate.color} size={24} />
                  <span className="truncate font-semibold">{roommate.name}</span>
                </span>
              ))
            ) : (
              <span className="block px-1 py-1 text-[12px] text-ink-soft">
                Names unavailable
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  )
}

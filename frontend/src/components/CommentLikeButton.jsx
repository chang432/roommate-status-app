import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Avatar from './Avatar.jsx'
import { avatarColor } from '../utils/avatar.js'

const POPOVER_GAP = 8
const VIEWPORT_MARGIN = 12

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
  const countButtonRef = useRef(null)
  const popoverRef = useRef(null)
  const onOpenChangeRef = useRef(onOpenChange)
  const popoverId = useId()
  const [popoverPosition, setPopoverPosition] = useState(null)
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
      const insideButton = rootRef.current?.contains(event.target)
      const insidePopover = popoverRef.current?.contains(event.target)
      if (!insideButton && !insidePopover) onOpenChangeRef.current(false)
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

  useLayoutEffect(() => {
    if (!open) {
      setPopoverPosition(null)
      return undefined
    }

    // The portal escapes the event panel's overflow clipping. Prefer the
    // count's right side, then clamp or flip vertically to stay on-screen.
    function updatePosition() {
      const anchor = countButtonRef.current?.getBoundingClientRect()
      const popover = popoverRef.current
      if (!anchor || !popover) return

      const width = popover.offsetWidth
      const height = popover.offsetHeight
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
      const left = Math.min(
        Math.max(anchor.right + POPOVER_GAP, VIEWPORT_MARGIN),
        maxLeft,
      )
      const below = anchor.bottom + POPOVER_GAP
      const above = anchor.top - height - POPOVER_GAP
      const preferredTop =
        below + height <= window.innerHeight - VIEWPORT_MARGIN ? below : above
      const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
      const top = Math.min(Math.max(preferredTop, VIEWPORT_MARGIN), maxTop)

      setPopoverPosition({ left, top })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [likers.length, open])

  const popover =
    open &&
    createPortal(
      <span
        ref={popoverRef}
        id={popoverId}
        role="dialog"
        aria-label="People who liked this comment"
        tabIndex={-1}
        style={{
          left: popoverPosition?.left ?? VIEWPORT_MARGIN,
          top: popoverPosition?.top ?? VIEWPORT_MARGIN,
          visibility: popoverPosition ? 'visible' : 'hidden',
        }}
        className="fixed z-50 max-h-[240px] w-max min-w-[170px] max-w-[min(260px,calc(100vw-24px))] overflow-y-auto rounded-sm border border-line bg-white p-2 shadow-card outline-none"
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
      </span>,
      document.body,
    )

  return (
    <span ref={rootRef} className="relative inline-flex">
      <span
        className={`inline-flex overflow-hidden rounded-full text-[11px] font-semibold ${
          liked ? 'bg-danger-soft text-status-red' : 'bg-surface-muted text-ink-soft'
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
          ref={countButtonRef}
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
      {popover}
    </span>
  )
}

import PeoplePopover from '../ui/PeoplePopover.jsx'
import { avatarColor } from '../../utils/avatar.js'

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
  const likers = likedByIds
    .map((id) => {
      const index = roommates.findIndex((roommate) => roommate.id === id)
      return index === -1 ? null : { ...roommates[index], color: avatarColor(index) }
    })
    .filter(Boolean)

  return (
    <span className="relative inline-flex">
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
          className="px-2 py-1 transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span aria-hidden="true">{liked ? '♥' : '♡'}</span>
        </button>
        <PeoplePopover
          people={likers}
          open={open}
          onOpenChange={onOpenChange}
          heading="Liked by"
          dialogLabel="People who liked this comment"
          buttonLabel={`View ${count} ${count === 1 ? 'person' : 'people'} who liked this comment`}
          disabled={count === 0}
          triggerClassName="border-l border-line px-2 py-1 transition hover:bg-surface-hover disabled:cursor-default disabled:opacity-60"
        >
          {count}
        </PeoplePopover>
      </span>
    </span>
  )
}

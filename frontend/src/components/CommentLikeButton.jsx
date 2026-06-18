export default function CommentLikeButton({
  count,
  liked,
  ownComment,
  busy,
  onToggle,
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={ownComment || busy}
      aria-pressed={liked}
      title={ownComment ? 'You cannot like your own comment' : undefined}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold transition ${
        liked
          ? 'bg-[#fbeae6] text-status-red'
          : 'bg-[#f5f0e8] text-ink-soft hover:bg-accent-soft'
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span aria-hidden="true">{liked ? '♥' : '♡'}</span>
      <span>{count}</span>
      <span className="sr-only">{liked ? 'Unlike comment' : 'Like comment'}</span>
    </button>
  )
}

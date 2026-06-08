// Visual affordance for the pull-to-refresh gesture (see usePullToRefresh): a
// pill of three dots that slides down and fades in as the user drags, then
// bounces in a staggered rhythm while the refresh is in flight.
export default function PullToRefreshIndicator({ pull, refreshing, threshold }) {
  if (pull <= 0 && !refreshing) return null

  // How "armed" the gesture is, 0..1 — drives the dots' fade-in and scale-up
  // before a refresh actually starts.
  const progress = Math.min(pull / threshold, 1)

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center"
      style={{
        transform: `translateY(${pull}px)`,
        opacity: refreshing ? 1 : progress,
      }}
    >
      <div className="mt-2 flex items-center gap-[6px] rounded-full bg-card px-[15px] py-[10px] shadow-card">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-[7px] w-[7px] rounded-full bg-accent ${
              refreshing ? 'animate-dot-bounce' : ''
            }`}
            style={
              refreshing
                ? { animationDelay: `${i * 140}ms` }
                : { transform: `scale(${0.55 + progress * 0.45})` }
            }
          />
        ))}
      </div>
    </div>
  )
}

import { useLayoutEffect, useRef, useState } from 'react'

// Visual affordance for the pull-to-refresh gesture (see usePullToRefresh): a
// pill of three dots that lives just above the top edge of the screen. As the
// user drags down it's pulled into view 1:1 with their finger; on release it
// springs back up off-screen (or holds in view while a refresh runs, the dots
// bouncing in a staggered rhythm).
export default function PullToRefreshIndicator({ pull, refreshing, threshold }) {
  const pillRef = useRef(null)
  // The pill's own height, used to park it fully off-screen at rest. Measured so
  // we don't hard-code a magic number that drifts if the styling changes.
  const [pillHeight, setPillHeight] = useState(56)

  useLayoutEffect(() => {
    if (pillRef.current) setPillHeight(pillRef.current.offsetHeight)
  }, [])

  // How "armed" the gesture is, 0..1 — drives the dots' scale-up before the
  // pull passes the threshold that actually triggers a refresh.
  const progress = Math.min(pull / threshold, 1)

  // Rest above the top edge (negative), then ride down with the pull.
  const translate = pull - pillHeight

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center"
      style={{
        transform: `translateY(${translate}px)`,
        // Follow the finger 1:1 while dragging; ease when springing back or
        // settling into the refreshing position.
        transition: pull > 0 && !refreshing ? 'none' : 'transform 260ms ease',
      }}
    >
      <div
        ref={pillRef}
        className="mt-3 flex items-center gap-[6px] rounded-full bg-card px-[15px] py-[10px] shadow-card"
      >
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

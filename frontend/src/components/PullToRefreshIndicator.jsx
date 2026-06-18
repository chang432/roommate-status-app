import { useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../utils/classNames.js'
import styles from './PullToRefreshIndicator.module.css'

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

  // Park fully above the top edge — the pill's height plus a small gap so it
  // sits just clear of the content once pulled in — then ride down with the
  // pull. GAP keeps the dots from sitting flush against the page content.
  const GAP = 12
  const translate = pull - pillHeight - GAP

  return (
    <div
      aria-hidden="true"
      className={styles.frame}
      style={{
        transform: `translateY(${translate}px)`,
        // Follow the finger 1:1 while dragging; ease when springing back or
        // settling into the refreshing position.
        transition: pull > 0 && !refreshing ? 'none' : 'transform 260ms ease',
      }}
    >
      <div
        ref={pillRef}
        className={styles.pill}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cx(styles.dot, refreshing && styles.refreshing)}
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

import { useEffect, useRef, useState } from 'react'

// How far (in px) the user must drag down before releasing triggers a refresh,
// and how far the indicator is allowed to travel so it never drifts too far.
const THRESHOLD = 64
const MAX_PULL = 96
const AXIS_LOCK_DISTANCE = 8
// Drag resistance: the indicator moves at a fraction of the finger so the pull
// feels rubber-bandy rather than 1:1.
const RESISTANCE = 0.5

// Pull-to-refresh for touch devices. This is the only way to reload data when
// the app is launched from the homescreen as a standalone PWA, where the
// browser's own reload control isn't available.
//
// A gesture only counts when it starts at the very top of the page (scrollY 0)
// and moves downward; on release past THRESHOLD it awaits onRefresh while
// holding the indicator open. Returns the live pull distance and refreshing
// flag for an indicator component to render.
export function usePullToRefresh(onRefresh) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  // Handlers are attached once, so read mutable values through refs to avoid
  // stale closures and needless re-subscription.
  const gesture = useRef(null)
  const pullRef = useRef(0)
  const refreshingRef = useRef(false)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    function setPullDistance(value) {
      pullRef.current = value
      setPull(value)
    }

    function onTouchStart(e) {
      // Only begin a pull when already scrolled to the top and idle.
      if (window.scrollY > 0 || refreshingRef.current) return
      const touch = e.touches[0]
      if (!touch) return
      gesture.current = {
        x: touch.clientX,
        y: touch.clientY,
        axis: null,
      }
    }

    function onTouchMove(e) {
      const currentGesture = gesture.current
      const touch = e.touches[0]
      if (!currentGesture || !touch) return
      const deltaX = touch.clientX - currentGesture.x
      const deltaY = touch.clientY - currentGesture.y
      if (
        !currentGesture.axis &&
        Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= AXIS_LOCK_DISTANCE
      ) {
        currentGesture.axis =
          Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical'
      }
      if (currentGesture.axis !== 'vertical') {
        setPullDistance(0)
        return
      }
      setPullDistance(deltaY <= 0 ? 0 : Math.min(deltaY * RESISTANCE, MAX_PULL))
    }

    async function onTouchEnd() {
      if (gesture.current === null) return
      gesture.current = null
      if (pullRef.current < THRESHOLD) {
        setPullDistance(0)
        return
      }
      refreshingRef.current = true
      setRefreshing(true)
      setPullDistance(THRESHOLD) // hold the indicator open while refreshing
      try {
        await onRefreshRef.current()
      } finally {
        refreshingRef.current = false
        setRefreshing(false)
        setPullDistance(0)
      }
    }

    function onTouchCancel() {
      gesture.current = null
      setPullDistance(0)
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd)
    window.addEventListener('touchcancel', onTouchCancel)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [])

  return { pull, refreshing, threshold: THRESHOLD }
}

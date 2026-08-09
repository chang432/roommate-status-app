export const SWIPE_PANEL_GAP_PX = 16;
export const FEED_PIN_TOLERANCE_PX = 1;

const SWIPE_MIN_X = 64;
const SWIPE_HORIZONTAL_LOCK_PX = 4;
const SWIPE_VERTICAL_LOCK_PX = 10;
const SWIPE_DRAG_RESISTANCE = 0.85;
const SWIPE_EDGE_RESISTANCE = 0.18;
const FEED_SWIPE_TRANSITION_MS = 220;
const FEED_SWIPE_FALLBACK_BUFFER_MS = 120;
const FEED_SWIPE_CLICK_SUPPRESSION_MS = FEED_SWIPE_TRANSITION_MS * 2;

function feedSwipeTransitionMs() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? 0
    : FEED_SWIPE_TRANSITION_MS;
}

export function createFeedSwipeHandlers({
  changeModuleType,
  clearSwipeScrollSnapshot,
  feedSwipePhase,
  feedSwipeScrollSnapshotRef,
  nextType,
  pendingFeedSwipeRef,
  previousType,
  rememberSwipeScrollSnapshot,
  setFeedSwipeOffset,
  setFeedSwipePhase,
  setFeedSwipeTargetType,
  setFeedSwipeTravelDistance,
  swipeClickBlockUntilRef,
  swipeFrameRef,
  swipeStartRef,
  swipeTimersRef,
}) {
  function scheduleFeedSwipe(callback, delay) {
    const timerId = window.setTimeout(() => {
      swipeTimersRef.current = swipeTimersRef.current.filter(
        (currentId) => currentId !== timerId,
      );
      callback();
    }, delay);
    swipeTimersRef.current.push(timerId);
  }

  function finishFeedSwipeTransition() {
    const pendingSwipe = pendingFeedSwipeRef.current;
    if (!pendingSwipe) return;

    pendingFeedSwipeRef.current = null;
    swipeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    swipeTimersRef.current = [];

    if (pendingSwipe.kind === "reset") {
      setFeedSwipePhase("idle");
      clearSwipeScrollSnapshot();
      setFeedSwipeTargetType(null);
      return;
    }

    // The browser has painted the final transform frame. Promote the same
    // incoming panel without replaying its horizontal motion.
    changeModuleType(pendingSwipe.destinationType, pendingSwipe.scrollSnapshot);
    setFeedSwipePhase("preparing");
    setFeedSwipeOffset(0);
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      // Keep transition:none committed for a painted frame before removing the
      // outgoing panel; otherwise Chromium can resume the old vertical
      // transform and make the promoted page shake.
      swipeFrameRef.current = window.requestAnimationFrame(() => {
        swipeFrameRef.current = null;
        setFeedSwipePhase("idle");
        clearSwipeScrollSnapshot();
        setFeedSwipeTargetType(null);
      });
    });
  }

  function scheduleFeedSwipeFallback() {
    const transitionMs = feedSwipeTransitionMs();
    scheduleFeedSwipe(
      finishFeedSwipeTransition,
      transitionMs === 0 ? 0 : transitionMs + FEED_SWIPE_FALLBACK_BUFFER_MS,
    );
  }

  function resetFeedSwipe() {
    if (feedSwipePhase === "idle") return;
    pendingFeedSwipeRef.current = { kind: "reset" };
    setFeedSwipePhase("settling");
    setFeedSwipeOffset(0);
    scheduleFeedSwipeFallback();
  }

  function handleFeedPanelTransitionEnd(event) {
    if (
      event.target !== event.currentTarget ||
      event.propertyName !== "transform" ||
      (feedSwipePhase !== "exiting" && feedSwipePhase !== "settling")
    ) {
      return;
    }
    finishFeedSwipeTransition();
  }

  function handleFeedClickCapture(event) {
    if (Date.now() >= swipeClickBlockUntilRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleFeedPointerDown(event) {
    if (feedSwipePhase !== "idle") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const panelWidth = event.currentTarget.getBoundingClientRect().width;
    // Track every surface below the tabs, but leave pointer ownership with the
    // original control until the movement clearly becomes a horizontal swipe.
    swipeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: panelWidth,
      axis: null,
      lastDeltaX: 0,
      scrollTop: window.scrollY,
    };
    setFeedSwipeTravelDistance(Math.max(panelWidth + SWIPE_PANEL_GAP_PX, 1));
  }

  function handleFeedPointerMove(event) {
    const start = swipeStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;

    if (start.axis === null) {
      if (
        Math.abs(deltaX) >= SWIPE_HORIZONTAL_LOCK_PX &&
        Math.abs(deltaX) > Math.abs(deltaY)
      ) {
        // Axis ownership is one-way: once horizontal wins, later vertical
        // movement cannot cancel the category swipe or move the page.
        start.axis = "horizontal";
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } else if (
        Math.abs(deltaY) >= SWIPE_VERTICAL_LOCK_PX &&
        Math.abs(deltaY) > Math.abs(deltaX)
      ) {
        swipeStartRef.current = null;
        return;
      } else {
        return;
      }
    }

    event.preventDefault();
    start.lastDeltaX = deltaX;
    if (Math.abs(window.scrollY - start.scrollTop) > FEED_PIN_TOLERANCE_PX) {
      window.scrollTo({
        top: start.scrollTop,
        left: window.scrollX,
        behavior: "auto",
      });
    }

    const direction = deltaX < 0 ? 1 : -1;
    const destinationType = direction > 0 ? nextType : previousType;
    const hasAdjacentType = Boolean(destinationType);
    rememberSwipeScrollSnapshot();
    setFeedSwipeTargetType(destinationType);
    setFeedSwipePhase("dragging");
    setFeedSwipeOffset(
      deltaX *
        (hasAdjacentType ? SWIPE_DRAG_RESISTANCE : SWIPE_EDGE_RESISTANCE),
    );
  }

  function finishFeedPointerGesture(event, cancelled = false) {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (start.axis !== "horizontal") return;

    event.preventDefault();
    const measuredDeltaX = event.clientX - start.x;
    const deltaX =
      !cancelled && Number.isFinite(measuredDeltaX)
        ? measuredDeltaX
        : start.lastDeltaX;
    swipeClickBlockUntilRef.current =
      Date.now() + FEED_SWIPE_CLICK_SUPPRESSION_MS;
    if (!Number.isFinite(deltaX) || Math.abs(deltaX) < SWIPE_MIN_X) {
      resetFeedSwipe();
      return;
    }

    const direction = deltaX < 0 ? 1 : -1;
    const destinationType = direction > 0 ? nextType : previousType;
    if (!destinationType) {
      resetFeedSwipe();
      return;
    }
    const travelDistance = Math.max(start.width + SWIPE_PANEL_GAP_PX, 1);

    // Suppress the synthetic click mobile browsers send after a completed
    // swipe, otherwise the departing card could open as it leaves the screen.
    swipeClickBlockUntilRef.current =
      Date.now() + FEED_SWIPE_CLICK_SUPPRESSION_MS;
    setFeedSwipePhase("exiting");
    setFeedSwipeOffset(direction * -travelDistance);
    setFeedSwipeTargetType(destinationType);
    const scrollSnapshot =
      feedSwipeScrollSnapshotRef.current ?? rememberSwipeScrollSnapshot();
    pendingFeedSwipeRef.current = {
      kind: "commit",
      destinationType,
      scrollSnapshot,
    };
    scheduleFeedSwipeFallback();
  }

  function handleFeedPointerUp(event) {
    finishFeedPointerGesture(event);
  }

  function handleFeedPointerCancel(event) {
    finishFeedPointerGesture(event, true);
  }

  return {
    handleFeedClickCapture,
    handleFeedPanelTransitionEnd,
    handleFeedPointerCancel,
    handleFeedPointerDown,
    handleFeedPointerMove,
    handleFeedPointerUp,
  };
}


import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const SWIPE_MIN_X = 64;
const SWIPE_HORIZONTAL_LOCK_PX = 4;
const SWIPE_VERTICAL_LOCK_PX = 10;
const SWIPE_DRAG_RESISTANCE = 0.85;
const SWIPE_EDGE_RESISTANCE = 0.18;
const SWIPE_PANEL_GAP_PX = 16;
const FEED_PIN_TOLERANCE_PX = 1;
const FEED_SWIPE_TRANSITION_MS = 220;
const FEED_SWIPE_FALLBACK_BUFFER_MS = 120;
const FEED_SWIPE_CLICK_SUPPRESSION_MS = FEED_SWIPE_TRANSITION_MS * 2;

function feedSwipeTransitionMs() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? 0
    : FEED_SWIPE_TRANSITION_MS;
}

export default function useFeedNavigation({
  activeType,
  loading,
  moduleTypes,
  restorableTypeIds,
  setActiveType,
  setNavigationError,
}) {
  const swipeStartRef = useRef(null);
  const swipeTimersRef = useRef([]);
  const swipeFrameRef = useRef(null);
  const pendingFeedSwipeRef = useRef(null);
  const swipeClickBlockUntilRef = useRef(0);
  const feedShellRef = useRef(null);
  const stickyHeaderRef = useRef(null);
  const feedHeaderPinnedRef = useRef(false);
  const categoryScrollPositionsRef = useRef(new Map());
  const pendingCategoryScrollRef = useRef(null);
  const deferredCategoryOffsetRef = useRef(null);
  const pendingDeferredConversionRef = useRef(null);
  const deferredConversionFrameRef = useRef(null);
  const feedSwipeScrollSnapshotRef = useRef(null);
  const [feedSwipeOffset, setFeedSwipeOffset] = useState(0);
  const [feedSwipePhase, setFeedSwipePhase] = useState("idle");
  const [feedSwipeTravelDistance, setFeedSwipeTravelDistance] = useState(1);
  const [feedSwipeScrollSnapshot, setFeedSwipeScrollSnapshot] = useState(null);
  const [feedSwipeTargetType, setFeedSwipeTargetTypeState] = useState(null);
  const [deferredCategoryOffset, setDeferredCategoryOffsetState] =
    useState(null);
  const [convertingDeferredOffset, setConvertingDeferredOffset] =
    useState(false);

  const activeTypeIndex = moduleTypes.findIndex(
    (type) => type.id === activeType,
  );
  const previousType = moduleTypes[activeTypeIndex - 1]?.id ?? null;
  const nextType = moduleTypes[activeTypeIndex + 1]?.id ?? null;
  const showAdjacentPanels = feedSwipePhase !== "idle";
  const visiblePanelTypes =
    showAdjacentPanels && feedSwipeTargetType
      ? [activeType, feedSwipeTargetType].filter(
          (type, index, types) => types.indexOf(type) === index,
        )
      : [activeType];

  useEffect(() => {
    categoryScrollPositionsRef.current.forEach((_, type) => {
      if (!restorableTypeIds.has(type)) {
        categoryScrollPositionsRef.current.delete(type);
      }
    });
    const deferredOffset = deferredCategoryOffsetRef.current;
    if (deferredOffset && !restorableTypeIds.has(deferredOffset.type)) {
      setDeferredCategoryOffset(null);
    }
  }, [restorableTypeIds]);

  useLayoutEffect(() => {
    const pendingScroll = pendingCategoryScrollRef.current;
    const shell = feedShellRef.current;
    if (!pendingScroll || pendingScroll.type !== activeType || !shell) return;

    pendingCategoryScrollRef.current = null;
    const shellTop = shell.getBoundingClientRect().top + window.scrollY;
    const maxScrollTop = Math.max(
      document.documentElement.scrollHeight - window.innerHeight,
      0,
    );
    window.scrollTo({
      top: Math.min(shellTop + pendingScroll.offset, maxScrollTop),
      left: window.scrollX,
      behavior: "auto",
    });
  }, [activeType]);

  useLayoutEffect(() => {
    const conversion = pendingDeferredConversionRef.current;
    if (!conversion || deferredCategoryOffset !== null) return;

    pendingDeferredConversionRef.current = null;
    const maxScrollTop = Math.max(
      document.documentElement.scrollHeight - window.innerHeight,
      0,
    );
    window.scrollTo({
      top: Math.min(conversion.top, maxScrollTop),
      left: window.scrollX,
      behavior: "auto",
    });
    if (deferredConversionFrameRef.current !== null) {
      window.cancelAnimationFrame(deferredConversionFrameRef.current);
    }
    deferredConversionFrameRef.current = window.requestAnimationFrame(() => {
      deferredConversionFrameRef.current = null;
      setConvertingDeferredOffset(false);
    });
  }, [deferredCategoryOffset]);

  useEffect(() => {
    if (loading) return undefined;
    const header = stickyHeaderRef.current;
    const shell = feedShellRef.current;
    if (!header || !shell) return undefined;

    function resetCategoryScrollState() {
      categoryScrollPositionsRef.current.clear();
      pendingCategoryScrollRef.current = null;
      pendingDeferredConversionRef.current = null;
      setDeferredCategoryOffset(null);
      setConvertingDeferredOffset(false);

      if (deferredConversionFrameRef.current !== null) {
        window.cancelAnimationFrame(deferredConversionFrameRef.current);
        deferredConversionFrameRef.current = null;
      }
      swipeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      swipeTimersRef.current = [];
      if (swipeFrameRef.current !== null) {
        window.cancelAnimationFrame(swipeFrameRef.current);
        swipeFrameRef.current = null;
      }
      pendingFeedSwipeRef.current = null;
      swipeStartRef.current = null;
      feedSwipeScrollSnapshotRef.current = null;
      setFeedSwipeScrollSnapshot(null);
      setFeedSwipeTargetTypeState(null);
      setFeedSwipeOffset(0);
      setFeedSwipePhase("idle");
    }

    function updateStickyState() {
      const shellTop = shell.getBoundingClientRect().top + window.scrollY;
      let headerIsPinned =
        window.scrollY > 0 &&
        window.scrollY >= shellTop - FEED_PIN_TOLERANCE_PX;
      const wasPinned = feedHeaderPinnedRef.current;
      const swipeSnapshot = feedSwipeScrollSnapshotRef.current;

      if (wasPinned && !headerIsPinned && swipeSnapshot?.hasEnteredFeed) {
        // A horizontal gesture owns the page axis through its handoff. Browser
        // touch drift and short-panel relayouts must not end the pinned session.
        const activeGesture = swipeStartRef.current;
        const maxScrollTop = Math.max(
          document.documentElement.scrollHeight - window.innerHeight,
          0,
        );
        const anchoredTop =
          activeGesture?.axis === "horizontal"
            ? activeGesture.scrollTop
            : Math.min(shellTop + swipeSnapshot.pageOffset, maxScrollTop);
        if (Math.abs(window.scrollY - anchoredTop) > FEED_PIN_TOLERANCE_PX) {
          window.scrollTo({
            top: anchoredTop,
            left: window.scrollX,
            behavior: "auto",
          });
        }
        headerIsPinned = true;
      }

      feedHeaderPinnedRef.current = headerIsPinned;
      header.toggleAttribute("data-feed-pinned", headerIsPinned);

      if (wasPinned && !headerIsPinned) {
        // Saved positions belong to the pinned feed session. Once the title
        // leaves the viewport edge, every category starts fresh from its top.
        resetCategoryScrollState();
        return;
      }

      const deferredOffset = deferredCategoryOffsetRef.current;
      if (!headerIsPinned || !deferredOffset) return;

      // Convert the panel-only offset into document scroll at the sticky
      // boundary. Clearing the transform and adding the same amount to the
      // page scroll in one layout commit keeps both title and content still.
      pendingDeferredConversionRef.current = {
        top: window.scrollY + deferredOffset.offset,
      };
      setConvertingDeferredOffset(true);
      setDeferredCategoryOffset(null);
    }

    updateStickyState();
    window.addEventListener("scroll", updateStickyState, { passive: true });
    window.addEventListener("resize", updateStickyState);
    return () => {
      window.removeEventListener("scroll", updateStickyState);
      window.removeEventListener("resize", updateStickyState);
    };
  }, [loading]);

  useEffect(
    () => () => {
      swipeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      swipeTimersRef.current = [];
      if (swipeFrameRef.current !== null) {
        window.cancelAnimationFrame(swipeFrameRef.current);
      }
      if (deferredConversionFrameRef.current !== null) {
        window.cancelAnimationFrame(deferredConversionFrameRef.current);
      }
    },
    [],
  );

  function setDeferredCategoryOffset(value) {
    deferredCategoryOffsetRef.current = value;
    setDeferredCategoryOffsetState(value);
  }

  function categoryScrollOffset(type) {
    if (!restorableTypeIds.has(type)) return 0;
    return categoryScrollPositionsRef.current.get(type) ?? 0;
  }

  function currentCategoryScrollSnapshot() {
    const shell = feedShellRef.current;
    if (!shell) {
      return { hasEnteredFeed: false, pageOffset: 0, logicalOffset: 0 };
    }

    const shellTop = shell.getBoundingClientRect().top + window.scrollY;
    const hasEnteredFeed = window.scrollY >= shellTop - 1;
    const pageOffset = hasEnteredFeed
      ? Math.max(window.scrollY - shellTop, 0)
      : 0;
    const deferredOffset =
      deferredCategoryOffsetRef.current?.type === activeType
        ? deferredCategoryOffsetRef.current.offset
        : 0;
    return {
      hasEnteredFeed,
      pageOffset,
      logicalOffset: deferredOffset + pageOffset,
    };
  }

  function rememberSwipeScrollSnapshot() {
    if (feedSwipeScrollSnapshotRef.current) {
      return feedSwipeScrollSnapshotRef.current;
    }

    const snapshot = currentCategoryScrollSnapshot();
    if (restorableTypeIds.has(activeType)) {
      categoryScrollPositionsRef.current.set(
        activeType,
        snapshot.logicalOffset,
      );
    } else {
      categoryScrollPositionsRef.current.delete(activeType);
    }
    feedSwipeScrollSnapshotRef.current = snapshot;
    setFeedSwipeScrollSnapshot(snapshot);
    return snapshot;
  }

  function clearSwipeScrollSnapshot() {
    feedSwipeScrollSnapshotRef.current = null;
    setFeedSwipeScrollSnapshot(null);
  }

  function setFeedSwipeTargetType(type) {
    setFeedSwipeTargetTypeState(type);
  }

  function clearScheduledFeedSwipe() {
    swipeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    swipeTimersRef.current = [];
    if (swipeFrameRef.current !== null) {
      window.cancelAnimationFrame(swipeFrameRef.current);
      swipeFrameRef.current = null;
    }
  }

  function changeModuleType(type, scrollSnapshot = null) {
    if (type === activeType) return;

    const snapshot = scrollSnapshot ?? currentCategoryScrollSnapshot();
    const destinationOffset = categoryScrollOffset(type);

    if (restorableTypeIds.has(activeType)) {
      categoryScrollPositionsRef.current.set(
        activeType,
        snapshot.logicalOffset,
      );
    } else {
      categoryScrollPositionsRef.current.delete(activeType);
    }
    if (snapshot.hasEnteredFeed) {
      // Restore in the destination's layout commit so the keyed incoming panel
      // keeps the same viewport position through its promotion to active.
      pendingCategoryScrollRef.current = {
        type,
        offset: destinationOffset,
      };
      setDeferredCategoryOffset(null);
    } else {
      // Before the title is sticky, preserve the page position and express the
      // saved category position relative to the title inside the clipped panel.
      pendingCategoryScrollRef.current = null;
      setDeferredCategoryOffset(
        destinationOffset > 0 ? { type, offset: destinationOffset } : null,
      );
    }

    setActiveType(type);
    setNavigationError("");
  }

  function selectModuleType(type) {
    clearScheduledFeedSwipe();
    pendingFeedSwipeRef.current = null;
    swipeStartRef.current = null;
    clearSwipeScrollSnapshot();
    setFeedSwipeTargetType(null);
    setFeedSwipeOffset(0);
    setFeedSwipePhase("idle");
    changeModuleType(type);
  }

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

  function panelVerticalOffset(type) {
    if (type === activeType) {
      return deferredCategoryOffset?.type === type
        ? -deferredCategoryOffset.offset
        : 0;
    }
    if (!feedSwipeScrollSnapshot) return 0;
    return feedSwipeScrollSnapshot.pageOffset - categoryScrollOffset(type);
  }

  function panelHorizontalOffset(type) {
    const typeIndex = moduleTypes.findIndex(
      (moduleType) => moduleType.id === type,
    );
    if (typeIndex < activeTypeIndex) {
      return `calc(-100% - ${SWIPE_PANEL_GAP_PX}px + ${feedSwipeOffset}px)`;
    }
    if (typeIndex > activeTypeIndex) {
      return `calc(100% + ${SWIPE_PANEL_GAP_PX}px + ${feedSwipeOffset}px)`;
    }
    return `${feedSwipeOffset}px`;
  }

  const resetCategoryPositions = useCallback(() => {
    categoryScrollPositionsRef.current.clear();
    pendingCategoryScrollRef.current = null;
    setDeferredCategoryOffset(null);
  }, []);

  return {
    activeTypeIndex,
    convertingDeferredOffset,
    deferredCategoryOffset,
    feedShellRef,
    feedSwipeOffset,
    feedSwipePhase,
    feedSwipeScrollSnapshot,
    feedSwipeTravelDistance,
    handleFeedClickCapture,
    handleFeedPanelTransitionEnd,
    handleFeedPointerCancel,
    handleFeedPointerDown,
    handleFeedPointerMove,
    handleFeedPointerUp,
    panelHorizontalOffset,
    panelVerticalOffset,
    resetCategoryPositions,
    selectModuleType,
    stickyHeaderRef,
    visiblePanelTypes,
  };
}

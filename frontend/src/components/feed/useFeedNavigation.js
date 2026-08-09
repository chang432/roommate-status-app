import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  createFeedSwipeHandlers,
  FEED_PIN_TOLERANCE_PX,
  SWIPE_PANEL_GAP_PX,
} from "./feedSwipeHandlers.js";

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

  const {
    handleFeedClickCapture,
    handleFeedPanelTransitionEnd,
    handleFeedPointerCancel,
    handleFeedPointerDown,
    handleFeedPointerMove,
    handleFeedPointerUp,
  } = createFeedSwipeHandlers({
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
  });

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

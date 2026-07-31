import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import ModuleFeedItem, { ModuleTag } from "./ModuleFeedItem.jsx";
import ModuleNav from "./ModuleNav.jsx";
import ModuleTabs from "./ModuleTabs.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { endActivity, startActivity } from "../../api/activities.js";
import useGroupModules from "../../hooks/useGroupModules.js";
import {
  FEED_MODULE_REGISTRY,
  FEED_MODULE_TYPES,
  canCreateFeedModule,
  canEditFeedModule,
  isFeedModuleEnabled,
  renderFeedModuleEdit,
} from "./feedModuleRegistry.jsx";
import {
  MODULE_PREFERENCE_VERSION,
  modulePreferenceKey,
  readModulePreferences,
} from "./modulePreferences.js";
import { getModuleCounts, modulesForCategory } from "./moduleSelectors.js";
import { cx } from "../../utils/classNames.js";
import {
  moduleFocusFromSearchParams,
  withoutModuleFocus,
} from "../../utils/moduleFocus.js";
import { isAdminIn } from "../../utils/roles.js";
import styles from "./GroupFeed.module.css";

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

export default function GroupFeed({ onLoadStateChange, ...props }) {
  const { user } = useAuth();
  const moduleState = useGroupModules(user.id, user.activeGroupId);

  useEffect(() => {
    onLoadStateChange?.(user.activeGroupId, moduleState.loading);
  }, [moduleState.loading, onLoadStateChange, user.activeGroupId]);

  return <GroupFeedView {...props} {...moduleState} />;
}

export function GroupFeedView({
  roommates,
  modules,
  loading,
  error: feedError,
  refreshModules,
  showStandardModules = true,
  showBookClub = false,
}) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeType, setActiveType] = useState("all");
  const [moduleOrder, setModuleOrder] = useState(
    () => readModulePreferences(user.id, user.activeGroupId).order,
  );
  const [allTypes, setAllTypes] = useState(
    () => readModulePreferences(user.id, user.activeGroupId).allTypes,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moduleNavEditing, setModuleNavEditing] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const [transitioningId, setTransitioningId] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState(null);
  const [editingModule, setEditingModule] = useState(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
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
  const canAdministerBookClub = isAdminIn(roommates, user.id);

  const enabledTypeIds = useMemo(() => {
    return new Set(
      Object.values(FEED_MODULE_REGISTRY)
        .filter((definition) =>
          isFeedModuleEnabled(definition, {
            showBookClub,
            showStandardModules,
          }),
        )
        .map((definition) => definition.id),
    );
  }, [showBookClub, showStandardModules]);

  const moduleTypes = useMemo(() => {
    const byId = new Map(FEED_MODULE_TYPES.map((type) => [type.id, type]));
    return [
      byId.get("all"),
      ...moduleOrder.map((id) => byId.get(id)).filter((type) => type && enabledTypeIds.has(type.id)),
    ].filter(Boolean);
  }, [enabledTypeIds, moduleOrder]);

  useEffect(() => {
    if (!moduleTypes.some((type) => type.id === activeType)) setActiveType("all");
  }, [activeType, moduleTypes]);

  useEffect(() => {
    const nextPreferences = readModulePreferences(user.id, user.activeGroupId);
    setModuleOrder(nextPreferences.order);
    setAllTypes(nextPreferences.allTypes);
    categoryScrollPositionsRef.current.clear();
    pendingCategoryScrollRef.current = null;
    setDeferredCategoryOffset(null);
  }, [user.activeGroupId, user.id]);

  useEffect(() => {
    localStorage.setItem(
      modulePreferenceKey(user.id, user.activeGroupId),
      JSON.stringify({
        version: MODULE_PREFERENCE_VERSION,
        order: moduleOrder,
        allTypes,
      }),
    );
  }, [allTypes, moduleOrder, user.activeGroupId, user.id]);

  const feedModules = useMemo(
    () =>
      modules.filter(
        (module) =>
          module.type !== "spotify" && enabledTypeIds.has(module.type),
      ),
    [enabledTypeIds, modules],
  );
  const moduleCounts = useMemo(
    () => getModuleCounts(feedModules, allTypes),
    [allTypes, feedModules],
  );

  const restorableTypeIds = useMemo(() => {
    const result = new Set();
    moduleTypes.forEach(({ id }) => {
      const typeModules = modulesForCategory(feedModules, allTypes, id);
      if (
        typeModules.some((module) => !module.isArchived) ||
        (archivedOpen && typeModules.some((module) => module.isArchived))
      ) {
        result.add(id);
      }
    });
    return result;
  }, [allTypes, archivedOpen, feedModules, moduleTypes]);
  const activeTypeIndex = moduleTypes.findIndex(
    (type) => type.id === activeType,
  );
  const previousType = moduleTypes[activeTypeIndex - 1]?.id ?? null;
  const nextType = moduleTypes[activeTypeIndex + 1]?.id ?? null;
  const showAdjacentPanels = feedSwipePhase !== "idle";
  const visiblePanelTypes = showAdjacentPanels && feedSwipeTargetType
    ? [activeType, feedSwipeTargetType].filter(
        (type, index, types) => types.indexOf(type) === index,
      )
    : [activeType];

  const focusIntent = useMemo(
    () => moduleFocusFromSearchParams(searchParams),
    [searchParams],
  );
  const moduleTypeIds = useMemo(
    () =>
      new Set(
        moduleTypes.filter((type) => type.id !== "all").map((type) => type.id),
      ),
    [moduleTypes],
  );

  const consumeFocusIntent = useCallback(
    (token) => {
      setSearchParams(
        (currentParams) => {
          const currentIntent = moduleFocusFromSearchParams(currentParams);
          return currentIntent?.token === token
            ? withoutModuleFocus(currentParams)
            : currentParams;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Navigation intent is consumed only after its target can be rendered. Feed
  // refreshes therefore cannot replay expansion, scrolling, or editor resets.
  useEffect(() => {
    if (!focusIntent) return;
    if (focusIntent.type === "spotify") {
      setNavigationError("");
      consumeFocusIntent(focusIntent.token);
      return;
    }
    if (!moduleTypeIds.has(focusIntent.type)) {
      setNavigationError("That module type is not available.");
      consumeFocusIntent(focusIntent.token);
      return;
    }

    setActiveType(focusIntent.type);
    if (!focusIntent.itemId) {
      setNavigationError("");
      consumeFocusIntent(focusIntent.token);
      return;
    }
    if (loading || feedError || mutationError) return;

    const target = modules.find(
      (module) =>
        module.type === focusIntent.type && module.id === focusIntent.itemId,
    );
    if (!target) {
      setNavigationError("That module is no longer available.");
      consumeFocusIntent(focusIntent.token);
      return;
    }

    setNavigationError("");
    if (target.isArchived) setArchivedOpen(true);
  }, [
    consumeFocusIntent,
    focusIntent,
    feedError,
    loading,
    mutationError,
    moduleTypeIds,
    modules,
  ]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

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
        if (
          Math.abs(window.scrollY - anchoredTop) > FEED_PIN_TOLERANCE_PX
        ) {
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

  // Every mutation surfaces through the unified feed, so each change handler
  // just refreshes it.
  const handleActivitiesChange = useCallback(
    () => refreshModules(),
    [refreshModules],
  );
  const handleShowsChange = useCallback(() => {
    window.dispatchEvent(new Event("roomie:shows-changed"));
    refreshModules();
  }, [refreshModules]);

  function moduleChangeHandler(type) {
    return type === "tv" ? handleShowsChange : handleActivitiesChange;
  }

  async function handleLiveTransition(activity, action) {
    if (transitioningId) return;
    setTransitioningId(activity.id);
    setMutationError("");
    try {
      const transition = action === "start" ? startActivity : endActivity;
      await transition(activity.id, user.id);
      refreshModules();
    } catch (err) {
      setMutationError(err.message || `Could not ${action} the event. Try again.`);
    } finally {
      setTransitioningId(null);
    }
  }

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
    setDrawerOpen(false);
  }

  function reorderModuleType(draggedType, targetType) {
    setModuleOrder((current) => {
      const next = [...current];
      const fromIndex = next.indexOf(draggedType);
      const toIndex = next.indexOf(targetType);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return current;
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
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
      transitionMs === 0
        ? 0
        : transitionMs + FEED_SWIPE_FALLBACK_BUFFER_MS,
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
    setFeedSwipeTravelDistance(
      Math.max(panelWidth + SWIPE_PANEL_GAP_PX, 1),
    );
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
    if (
      Math.abs(window.scrollY - start.scrollTop) > FEED_PIN_TOLERANCE_PX
    ) {
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

  function openCreateModal() {
    const definition = FEED_MODULE_REGISTRY[activeType];
    if (
      definition &&
      !canCreateFeedModule(definition, { canAdministerBookClub })
    ) {
      return;
    }
    setCreateType(activeType === "all" ? null : activeType);
    setCreateModalOpen(true);
  }

  function renderCreateContent() {
    if (!createType) {
      return (
        <div className={styles.createPicker}>
          {moduleTypes
            .filter((type) => type.id !== "all")
            .filter((type) =>
              canCreateFeedModule(FEED_MODULE_REGISTRY[type.id], {
                canAdministerBookClub,
              }),
            )
            .map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => setCreateType(type.id)}
                className={cx(styles.modulePalette, styles.createPickerButton)}
                data-module-type={type.id}
              >
                {FEED_MODULE_REGISTRY[type.id].createLabel}
              </button>
            ))}
        </div>
      );
    }

    const definition = FEED_MODULE_REGISTRY[createType];
    return definition.renderCreate({
      roommates,
      onChanged: moduleChangeHandler(createType),
      onClose: () => setCreateModalOpen(false),
    });
  }

  function renderModule(module, onEdit) {
    const definition = FEED_MODULE_REGISTRY[module.type];
    if (!definition) return null;
    const moduleTag = <ModuleTag module={module} />;
    return definition.renderCard({
      module,
      moduleTag,
      onChanged: moduleChangeHandler(module.type),
      onEdit,
      onLiveTransition: handleLiveTransition,
      roommates,
      transitioningId,
      canAdministerBookClub,
    });
  }

  function renderFeedPanel(type, isActivePanel) {
    const visibleModules = modulesForCategory(feedModules, allTypes, type);
    const activeModules = visibleModules.filter((module) => !module.isArchived);
    const archivedModules = visibleModules.filter((module) => module.isArchived);
    const panelFocusIntent = isActivePanel ? focusIntent : null;

    return (
      <>
        <div className={styles.feedList}>
          {activeModules.length === 0 ? (
            <p className={styles.emptyFeed}>No active modules here yet.</p>
          ) : (
            activeModules.map((module) => (
              <ModuleFeedItem
                key={`${module.type}:${module.id}`}
                module={module}
                focusIntent={panelFocusIntent}
                onFocusHandled={consumeFocusIntent}
                canEdit={canEditFeedModule(
                  FEED_MODULE_REGISTRY[module.type],
                  module,
                  user.id,
                )}
                onEdit={() => setEditingModule(module)}
              >
                {(onEdit) => renderModule(module, onEdit)}
              </ModuleFeedItem>
            ))
          )}
        </div>

        {archivedModules.length > 0 && (
          <div className={styles.feedArchiveSection}>
            <button
              type="button"
              onClick={() => setArchivedOpen((current) => !current)}
              className={styles.feedArchiveToggle}
              aria-expanded={archivedOpen}
            >
              <span>Archived ({archivedModules.length})</span>
              <span aria-hidden="true">{archivedOpen ? "▴" : "▾"}</span>
            </button>
            {archivedOpen && (
              <div className={styles.feedList}>
                {archivedModules.map((module) => (
                  <ModuleFeedItem
                    key={`${module.type}:${module.id}`}
                    module={module}
                    focusIntent={panelFocusIntent}
                    onFocusHandled={consumeFocusIntent}
                    canEdit={canEditFeedModule(
                      FEED_MODULE_REGISTRY[module.type],
                      module,
                      user.id,
                    )}
                    onEdit={() => setEditingModule(module)}
                  >
                    {(onEdit) => renderModule(module, onEdit)}
                  </ModuleFeedItem>
                ))}
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  const createTitle = createType
    ? FEED_MODULE_REGISTRY[createType].createLabel
    : "Create a module";
  const createLabel =
    activeType === "all"
      ? "Create a module"
      : FEED_MODULE_REGISTRY[activeType].createLabel;
  const canCreateModule = showStandardModules || showBookClub;

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
    const typeIndex = moduleTypes.findIndex((moduleType) => moduleType.id === type);
    if (typeIndex < activeTypeIndex) {
      return `calc(-100% - ${SWIPE_PANEL_GAP_PX}px + ${feedSwipeOffset}px)`;
    }
    if (typeIndex > activeTypeIndex) {
      return `calc(100% + ${SWIPE_PANEL_GAP_PX}px + ${feedSwipeOffset}px)`;
    }
    return `${feedSwipeOffset}px`;
  }

  if (loading) {
    return <p className={styles.loading}>Loading the feed…</p>;
  }

  return (
    <section className={styles.feedSection}>
      {(feedError || mutationError) && (
        <p className={cx("ui-errorBox", styles.pageError)}>
          {feedError || mutationError}
        </p>
      )}
      {navigationError && (
        <p className={cx("ui-errorBox", styles.pageError)}>{navigationError}</p>
      )}

      <div ref={feedShellRef} className={styles.shell} data-feed-shell>
        <ModuleNav
          activeType={activeType}
          counts={moduleCounts}
          moduleTypes={moduleTypes}
          drawerOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onSelect={selectModuleType}
          editMode={moduleNavEditing}
          onEditModeChange={setModuleNavEditing}
          allTypes={allTypes}
          onAllTypesChange={setAllTypes}
          onReorderType={reorderModuleType}
        />

        <div
          ref={stickyHeaderRef}
          className={styles.feedStickyHeader}
          data-feed-sticky-header
        >
          <div className={styles.feedHeader} data-feed-title-row>
            <h2 className={styles.feedTitle}>Group Feed</h2>
            <div className={styles.createInlineSlot} data-feed-create-slot>
              {canCreateModule &&
                (activeType === "all" ||
                  canCreateFeedModule(FEED_MODULE_REGISTRY[activeType], {
                    canAdministerBookClub,
                  })) && (
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className={styles.createInlineButton}
                    aria-label={createLabel}
                    title={createLabel}
                  >
                    +
                  </button>
                )}
            </div>
          </div>
          <div className={styles.feedCategoryRow} data-feed-category-row>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={styles.feedMenuButton}
              aria-label="Open feed menu"
              aria-controls="group-feed-menu"
              aria-expanded={drawerOpen}
            >
              <span className={styles.feedMenuIcon} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>
            <ModuleTabs
              activeType={activeType}
              counts={moduleCounts}
              moduleTypes={moduleTypes}
              onSelect={selectModuleType}
              swipeOffset={feedSwipeOffset}
              swipePhase={feedSwipePhase}
              swipeTravelDistance={feedSwipeTravelDistance}
            />
          </div>
        </div>

        <main
          className={styles.feedColumn}
          data-feed-swipe-surface
          onPointerDown={handleFeedPointerDown}
          onPointerMove={handleFeedPointerMove}
          onPointerUp={handleFeedPointerUp}
          onClickCapture={handleFeedClickCapture}
          onPointerCancel={handleFeedPointerCancel}
        >
          <div
            className={cx(
              styles.feedViewport,
              deferredCategoryOffset ||
                convertingDeferredOffset ||
                (feedSwipeScrollSnapshot &&
                  !feedSwipeScrollSnapshot.hasEnteredFeed)
                ? styles.feedViewportAnchored
                : "",
            )}
            data-feed-swipe-phase={feedSwipePhase}
          >
            {visiblePanelTypes.map((type) => {
              const isActivePanel = type === activeType;
              const verticalOffset = panelVerticalOffset(type);
              return (
                <div
                  key={type}
                  id={isActivePanel ? `feed-panel-${type}` : undefined}
                  role={isActivePanel ? "tabpanel" : undefined}
                  aria-labelledby={isActivePanel ? `feed-tab-${type}` : undefined}
                  onTransitionEnd={
                    isActivePanel ? handleFeedPanelTransitionEnd : undefined
                  }
                  className={cx(
                    styles.feedPanel,
                    isActivePanel ? "" : styles.feedPanelAdjacent,
                    feedSwipePhase === "dragging" ||
                      feedSwipePhase === "preparing" ||
                      (isActivePanel && convertingDeferredOffset)
                      ? styles.feedPanelDirect
                      : "",
                  )}
                  style={{
                    transform: `translate3d(${panelHorizontalOffset(type)}, ${
                      verticalOffset ? `${verticalOffset}px` : "0"
                    }, 0)`,
                  }}
                  data-feed-panel-type={type}
                  aria-hidden={isActivePanel ? undefined : "true"}
                  inert={isActivePanel ? undefined : ""}
                >
                  {renderFeedPanel(type, isActivePanel)}
                </div>
              );
            })}
          </div>
        </main>
      </div>

      {createModalOpen && (
        <ModalShell
          title={createTitle}
          onClose={() => setCreateModalOpen(false)}
          widthClassName={styles.createModal}
        >
          {renderCreateContent()}
        </ModalShell>
      )}
      {editingModule && (
        <ModalShell
          title={FEED_MODULE_REGISTRY[editingModule.type].edit.label}
          onClose={() => setEditingModule(null)}
          widthClassName={styles.createModal}
        >
          {renderFeedModuleEdit(
            FEED_MODULE_REGISTRY[editingModule.type],
            {
              module: editingModule,
              roommates,
              onChanged: refreshModules,
              onSaved: async () => {
                await refreshModules();
                setEditingModule(null);
              },
              onClose: () => setEditingModule(null),
              onCancel: () => setEditingModule(null),
            },
          )}
        </ModalShell>
      )}
    </section>
  );
}

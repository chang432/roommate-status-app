import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import ActivityCreateForm from "./ActivityCreateForm.jsx";
import ChecklistCreateForm from "./ChecklistCreateForm.jsx";
import ChecklistFeature from "./ChecklistFeature.jsx";
import ModalShell from "./ModalShell.jsx";
import ModuleEditForm from "./ModuleEditForm.jsx";
import ProposeActivity from "./ProposeActivity.jsx";
import RequestCreateForm from "./RequestCreateForm.jsx";
import RequestFeature from "./RequestFeature.jsx";
import ShowCreateForm from "./ShowCreateForm.jsx";
import ShowTrackerFeature from "./ShowTrackerFeature.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { ModuleFocusProvider } from "../context/ModuleFocusContext.jsx";
import { endActivity, getFeed, startActivity } from "../api/client.js";
import {
  MODULE_TYPES,
  MODULE_DEFINITIONS,
  createModules,
} from "../models/modules.js";
import { cx } from "../utils/classNames.js";
import {
  moduleFocusFromSearchParams,
  withoutModuleFocus,
} from "../utils/moduleFocus.js";
import { useLongPress } from "../utils/useLongPress.js";
// The feed shares the status page's stylesheet — it renders inline beneath the
// status section on the same page.
import styles from "../pages/StatusPage.module.css";

const FEED_POLL_INTERVAL_MS = 5000;
const EDIT_HEADER_SELECTOR = "[data-module-edit-header]";
const EDIT_KEYBOARD_SELECTOR = "[data-module-edit-keyboard]";
const INTERACTIVE_SELECTOR = "button, a, input, textarea, select";
const SWIPE_MIN_X = 64;
const SWIPE_MAX_Y = 48;
const SWIPE_DRAG_RESISTANCE = 0.85;
const FEED_SWIPE_TRANSITION_MS = 220;
const FEED_SWIPE_CLICK_SUPPRESSION_MS = FEED_SWIPE_TRANSITION_MS * 2;

const CREATE_LABEL_BY_TYPE = {
  events: "Create an event",
  requests: "Create a request",
  checklists: "Create a checklist",
  tv: "Add a show",
};

function modulePreferenceKey(userId, groupId) {
  return `roomie-module-preferences:${userId}:${groupId}`;
}

function sanitizeModuleOrder(value) {
  const available = MODULE_TYPES.filter((type) => type.id !== "all").map(
    (type) => type.id,
  );
  const seen = new Set();
  const ordered = Array.isArray(value)
    ? value.filter(
        (id) => available.includes(id) && !seen.has(id) && seen.add(id),
      )
    : [];
  return [...ordered, ...available.filter((id) => !seen.has(id))];
}

function sanitizeAllTypes(value, orderedTypes) {
  const selected = Array.isArray(value)
    ? value.filter((id) => orderedTypes.includes(id))
    : orderedTypes;
  return selected.length > 0 ? selected : [orderedTypes[0]].filter(Boolean);
}

function readModulePreferences(userId, groupId) {
  try {
    const stored = JSON.parse(
      localStorage.getItem(modulePreferenceKey(userId, groupId)) || "null",
    );
    const order = sanitizeModuleOrder(stored?.order);
    return { order, allTypes: sanitizeAllTypes(stored?.allTypes, order) };
  } catch {
    const order = sanitizeModuleOrder(null);
    return { order, allTypes: sanitizeAllTypes(null, order) };
  }
}

function ModuleNav({
  activeType,
  modules,
  moduleTypes,
  drawerOpen,
  onClose,
  onSelect,
  editMode,
  onEditModeChange,
  allTypes,
  onAllTypesChange,
  onReorderType,
}) {
  const navRef = useRef(null);
  const dragPointerRef = useRef(null);
  const dragTypeRef = useRef(null);
  const lastDropTypeRef = useRef(null);
  const editRowRefs = useRef(new Map());
  const rowPositionsBeforeReorderRef = useRef(null);
  const [allDropdownOpen, setAllDropdownOpen] = useState(false);
  const [draggingType, setDraggingType] = useState(null);
  const counts = modules.reduce((acc, module) => {
    if (module.isArchived) return acc;
    acc[module.type] = (acc[module.type] ?? 0) + 1;
    return acc;
  }, {});
  counts.all = modules.filter(
    (module) => !module.isArchived && allTypes.includes(module.type),
  ).length;
  const editableTypes = moduleTypes.filter((type) => type.id !== "all");
  const selectedAllLabels = editableTypes
    .filter((type) => allTypes.includes(type.id))
    .map((type) => type.shortLabel || type.label);

  function handleAllTypeToggle(typeId, checked) {
    const next = checked
      ? [...allTypes, typeId]
      : allTypes.filter((id) => id !== typeId);
    onAllTypesChange(
      sanitizeAllTypes(
        next,
        editableTypes.map((type) => type.id),
      ),
    );
  }

  function reorderType(draggedType, targetType) {
    if (
      !draggedType ||
      !targetType ||
      draggedType === targetType ||
      lastDropTypeRef.current === targetType
    ) {
      return;
    }

    // Capture each row before the order updates. The layout effect below
    // animates it from this position into its new spot (a FLIP animation).
    rowPositionsBeforeReorderRef.current = new Map(
      [...editRowRefs.current].map(([typeId, row]) => [
        typeId,
        row.getBoundingClientRect().top,
      ]),
    );
    lastDropTypeRef.current = targetType;
    onReorderType(draggedType, targetType);
  }

  useLayoutEffect(() => {
    const previousPositions = rowPositionsBeforeReorderRef.current;
    rowPositionsBeforeReorderRef.current = null;
    if (!previousPositions) return;

    previousPositions.forEach((previousTop, typeId) => {
      const row = editRowRefs.current.get(typeId);
      if (!row) return;
      const distance = previousTop - row.getBoundingClientRect().top;
      if (!distance) return;
      row.animate?.(
        [
          { transform: `translateY(${distance}px)` },
          { transform: "translateY(0)" },
        ],
        { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    });
  }, [moduleTypes]);

  const finishEditing = useCallback(() => {
    onEditModeChange(false);
    setAllDropdownOpen(false);
    setDraggingType(null);
    dragPointerRef.current = null;
    dragTypeRef.current = null;
    lastDropTypeRef.current = null;
  }, [onEditModeChange]);

  function finishTouchDrag(event) {
    const drag = dragPointerRef.current;
    dragPointerRef.current = null;
    if (!drag || event.pointerId !== drag.pointerId) {
      setDraggingType(null);
      dragTypeRef.current = null;
      lastDropTypeRef.current = null;
      return;
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const dropTarget = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest("[data-module-drop-type], [data-module-type]");
    const dropType =
      dropTarget?.getAttribute("data-module-drop-type") ||
      dropTarget?.getAttribute("data-module-type");
    reorderType(drag.type, dropType);
    setDraggingType(null);
    dragTypeRef.current = null;
    lastDropTypeRef.current = null;
  }

  function previewTouchDrag(event) {
    const drag = dragPointerRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dropType = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest("[data-module-drop-type]")
      ?.getAttribute("data-module-drop-type");
    reorderType(drag.type, dropType);
  }

  useEffect(() => {
    if (!editMode) return undefined;
    function handlePointerDown(event) {
      if (navRef.current?.contains(event.target)) return;
      finishEditing();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [editMode, finishEditing]);

  useEffect(() => {
    if (drawerOpen) return;
    finishEditing();
  }, [drawerOpen, finishEditing]);

  return (
    <>
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close module list"
          className={styles.drawerBackdrop}
          onClick={() => {
            finishEditing();
            onClose();
          }}
        />
      ) : null}
      <aside
        ref={navRef}
        className={cx(styles.moduleNav, drawerOpen ? styles.moduleNavOpen : "")}
        aria-label="Module types"
      >
        <div className={styles.moduleNavHeader}>
          <p className={styles.moduleNavEyebrow}>Modules</p>
          <div className={styles.moduleNavHeaderActions}>
            <button
              type="button"
              className={styles.moduleNavEdit}
              onClick={() => {
                if (editMode) finishEditing();
                else onEditModeChange(true);
              }}
            >
              {editMode ? "Done" : "Edit"}
            </button>
            <button
              type="button"
              className={styles.moduleNavClose}
              onClick={() => {
                finishEditing();
                onClose();
              }}
            >
              Close
            </button>
          </div>
        </div>
        <div className={styles.moduleNavList}>
          {moduleTypes.map((type) => {
            const filterContent = (
              <>
                <span>{type.label}</span>
                <span className={styles.moduleNavCount}>
                  {counts[type.id] ?? 0}
                </span>
              </>
            );
            const filterButton = editMode ? (
              <div
                key={type.id}
                data-module-type={type.id === "all" ? undefined : type.id}
                className={cx(
                  styles.moduleNavItem,
                  styles.moduleNavItemEditing,
                  type.id === "all" ? "" : styles.modulePalette,
                  activeType === type.id ? styles.moduleNavItemActive : "",
                )}
              >
                {filterContent}
              </div>
            ) : (
              <button
                key={type.id}
                type="button"
                onClick={() => onSelect(type.id)}
                data-module-type={type.id === "all" ? undefined : type.id}
                className={cx(
                  styles.moduleNavItem,
                  type.id === "all" ? "" : styles.modulePalette,
                  activeType === type.id ? styles.moduleNavItemActive : "",
                )}
              >
                {filterContent}
              </button>
            );
            if (!editMode) return filterButton;
            if (type.id === "all") {
              return (
                <div key={type.id} className={styles.moduleNavAllEditor}>
                  <button
                    type="button"
                    className={cx(
                      styles.moduleNavItem,
                      styles.moduleNavAllDropdown,
                      activeType === type.id ? styles.moduleNavItemActive : "",
                    )}
                    onClick={() => setAllDropdownOpen((current) => !current)}
                    aria-expanded={allDropdownOpen}
                  >
                    <span>{type.label}</span>
                    <span className={styles.moduleNavAllSummary}>
                      {selectedAllLabels.length === editableTypes.length
                        ? "All selected"
                        : `${selectedAllLabels.length} selected`}
                      <span aria-hidden="true">
                        {allDropdownOpen ? "▴" : "▾"}
                      </span>
                    </span>
                  </button>
                  {allDropdownOpen ? (
                    <div className={styles.moduleNavAllMenu}>
                      {editableTypes.map((option) => (
                        <label
                          key={option.id}
                          className={styles.moduleNavAllOption}
                        >
                          <input
                            type="checkbox"
                            checked={allTypes.includes(option.id)}
                            onChange={(event) =>
                              handleAllTypeToggle(
                                option.id,
                                event.target.checked,
                              )
                            }
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            }
            return (
              <div
                key={type.id}
                ref={(element) => {
                  if (element) editRowRefs.current.set(type.id, element);
                  else editRowRefs.current.delete(type.id);
                }}
                data-module-drop-type={type.id}
                className={cx(
                  styles.moduleNavEditRow,
                  draggingType === type.id
                    ? styles.moduleNavEditRowDragging
                    : "",
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  reorderType(dragTypeRef.current, type.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedId = event.dataTransfer.getData("text/plain");
                  reorderType(draggedId, type.id);
                  setDraggingType(null);
                  dragTypeRef.current = null;
                  lastDropTypeRef.current = null;
                }}
              >
                {filterButton}
                <button
                  type="button"
                  draggable
                  className={styles.moduleNavDragHandle}
                  aria-label={`Drag ${type.label} to reorder`}
                  onPointerDown={(event) => {
                    if (event.pointerType === "mouse") return;
                    event.preventDefault();
                    dragPointerRef.current = {
                      pointerId: event.pointerId,
                      type: type.id,
                    };
                    dragTypeRef.current = type.id;
                    lastDropTypeRef.current = null;
                    setDraggingType(type.id);
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                  }}
                  onPointerMove={previewTouchDrag}
                  onPointerUp={finishTouchDrag}
                  onPointerCancel={(event) => {
                    if (dragPointerRef.current?.pointerId === event.pointerId) {
                      dragPointerRef.current = null;
                      dragTypeRef.current = null;
                      lastDropTypeRef.current = null;
                      setDraggingType(null);
                      event.currentTarget.releasePointerCapture?.(
                        event.pointerId,
                      );
                    }
                  }}
                  onDragStart={(event) => {
                    dragTypeRef.current = type.id;
                    lastDropTypeRef.current = null;
                    setDraggingType(type.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", type.id);
                  }}
                  onDragEnd={() => {
                    dragTypeRef.current = null;
                    lastDropTypeRef.current = null;
                    setDraggingType(null);
                  }}
                >
                  ☰
                </button>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}

function ModuleTag({ module }) {
  return (
    <span
      className={cx(styles.modulePalette, styles.moduleType)}
      data-module-type={module.type}
    >
      {module.typeLabel}
    </span>
  );
}

function ModuleFeedItem({
  module,
  focusIntent,
  onFocusHandled,
  canEdit,
  onEdit,
  children,
}) {
  const itemRef = useRef(null);
  const matchingIntent =
    focusIntent?.itemId === module.id && focusIntent.type === module.type
      ? focusIntent
      : null;
  const longPressHandlers = useLongPress({
    enabled: canEdit,
    onLongPress: onEdit,
    isPointerTarget: (event) => {
      const header = event.target.closest?.(EDIT_HEADER_SELECTOR);
      if (!header || !event.currentTarget.contains(header)) return false;
      const interactive = event.target.closest?.(INTERACTIVE_SELECTOR);
      return (
        !interactive || !header.contains(interactive) || interactive === header
      );
    },
    isKeyboardTarget: (event) =>
      event.target.matches?.(EDIT_KEYBOARD_SELECTOR) &&
      event.currentTarget.contains(event.target),
  });
  const editTrigger = {
    enabled: canEdit,
    headerProps: canEdit
      ? {
          "data-module-edit-header": "",
          title: "Long-press to edit",
        }
      : {},
    keyboardProps: canEdit
      ? {
          "data-module-edit-keyboard": "",
          "aria-description": "Hold Enter or Space to edit",
        }
      : {},
  };

  useEffect(() => {
    if (!matchingIntent) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      itemRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      onFocusHandled(matchingIntent.token);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [matchingIntent, onFocusHandled]);

  return (
    <ModuleFocusProvider intent={matchingIntent}>
      <article
        ref={itemRef}
        className={styles.moduleItem}
        {...longPressHandlers}
      >
        {children(editTrigger)}
      </article>
    </ModuleFocusProvider>
  );
}

// The group feed, rendered inline below the status section. Owns its own feed
// polling and create/filter UI; `roommates` come from the parent status page so
// we don't double-fetch the household.
export default function GroupFeed({ roommates, onLoadStateChange }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [modules, setModules] = useState([]);
  const [activeType, setActiveType] = useState("all");
  const [moduleOrder, setModuleOrder] = useState(
    () => readModulePreferences(user.id, user.activeGroupId).order,
  );
  const [allTypes, setAllTypes] = useState(
    () => readModulePreferences(user.id, user.activeGroupId).allTypes,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moduleNavEditing, setModuleNavEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [liveError, setLiveError] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const [transitioningId, setTransitioningId] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState(null);
  const [editingModule, setEditingModule] = useState(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const swipeStartRef = useRef(null);
  const swipeTimersRef = useRef([]);
  const swipeFrameRef = useRef(null);
  const swipeClickBlockUntilRef = useRef(0);
  const [feedSwipeOffset, setFeedSwipeOffset] = useState(0);
  const [feedSwipePhase, setFeedSwipePhase] = useState("idle");

  const moduleTypes = useMemo(() => {
    const byId = new Map(MODULE_TYPES.map((type) => [type.id, type]));
    return [
      byId.get("all"),
      ...moduleOrder.map((id) => byId.get(id)).filter(Boolean),
    ].filter(Boolean);
  }, [moduleOrder]);

  useEffect(() => {
    const nextPreferences = readModulePreferences(user.id, user.activeGroupId);
    setModuleOrder(nextPreferences.order);
    setAllTypes(nextPreferences.allTypes);
  }, [user.activeGroupId, user.id]);

  useEffect(() => {
    localStorage.setItem(
      modulePreferenceKey(user.id, user.activeGroupId),
      JSON.stringify({ order: moduleOrder, allTypes }),
    );
  }, [allTypes, moduleOrder, user.activeGroupId, user.id]);

  const loadFeed = useCallback(async () => {
    try {
      setModules(
        createModules(await getFeed(user.id, "all", user.activeGroupId)),
      );
      setLiveError("");
    } catch {
      setLiveError("Could not load the group feed.");
    }
  }, [user.activeGroupId, user.id]);

  useEffect(() => {
    let isCurrent = true;
    const groupId = user.activeGroupId;
    setLoading(true);
    onLoadStateChange?.(groupId, true);
    loadFeed().finally(() => {
      if (!isCurrent) return;
      setLoading(false);
      onLoadStateChange?.(groupId, false);
    });
    return () => {
      isCurrent = false;
    };
  }, [loadFeed, onLoadStateChange, user.activeGroupId]);

  useEffect(() => {
    let pollId = null;

    function startPolling() {
      if (pollId !== null || document.visibilityState !== "visible") return;
      pollId = window.setInterval(loadFeed, FEED_POLL_INTERVAL_MS);
    }

    function stopPolling() {
      if (pollId === null) return;
      window.clearInterval(pollId);
      pollId = null;
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        loadFeed();
        startPolling();
      } else {
        stopPolling();
      }
    }

    // Any feature change ("activities-changed", "requests-changed", …) just
    // refreshes the unified feed.
    function handleServiceWorkerMessage(event) {
      if (event.data?.type?.endsWith("-changed")) loadFeed();
    }

    startPolling();
    window.addEventListener("focus", loadFeed);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    navigator.serviceWorker?.addEventListener(
      "message",
      handleServiceWorkerMessage,
    );

    return () => {
      stopPolling();
      window.removeEventListener("focus", loadFeed);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      navigator.serviceWorker?.removeEventListener(
        "message",
        handleServiceWorkerMessage,
      );
    };
  }, [loadFeed]);

  const visibleModules = useMemo(
    () =>
      activeType === "all"
        ? modules.filter((module) => allTypes.includes(module.type))
        : modules.filter((module) => module.type === activeType),
    [activeType, allTypes, modules],
  );
  const activeModules = useMemo(
    () => visibleModules.filter((module) => !module.isArchived),
    [visibleModules],
  );
  const archivedModules = useMemo(
    () => visibleModules.filter((module) => module.isArchived),
    [visibleModules],
  );

  const feedModules = useMemo(
    () => modules.filter((module) => module.type !== "spotify"),
    [modules],
  );

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
    if (loading || liveError) return;

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
    liveError,
    loading,
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

  useEffect(
    () => () => {
      swipeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      swipeTimersRef.current = [];
      if (swipeFrameRef.current !== null) {
        window.cancelAnimationFrame(swipeFrameRef.current);
      }
    },
    [],
  );

  // Every mutation surfaces through the unified feed, so each change handler
  // just refreshes it.
  const handleActivitiesChange = useCallback(() => loadFeed(), [loadFeed]);
  const handleRequestsChange = useCallback(() => loadFeed(), [loadFeed]);
  const handleChecklistsChange = useCallback(() => loadFeed(), [loadFeed]);
  const handleShowsChange = useCallback(() => {
    window.dispatchEvent(new Event("roomie:shows-changed"));
    loadFeed();
  }, [loadFeed]);

  async function handleLiveTransition(activity, action) {
    if (transitioningId) return;
    setTransitioningId(activity.id);
    setLiveError("");
    try {
      const transition = action === "start" ? startActivity : endActivity;
      await transition(activity.id, user.id);
      loadFeed();
    } catch (err) {
      setLiveError(err.message || `Could not ${action} the event. Try again.`);
    } finally {
      setTransitioningId(null);
    }
  }

  function selectModuleType(type) {
    setActiveType(type);
    setNavigationError("");
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

  function resetFeedSwipe() {
    if (feedSwipePhase === "idle") return;
    setFeedSwipePhase("settling");
    setFeedSwipeOffset(0);
    scheduleFeedSwipe(() => setFeedSwipePhase("idle"), FEED_SWIPE_TRANSITION_MS);
  }

  function handleFeedClickCapture(event) {
    if (Date.now() >= swipeClickBlockUntilRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleFeedPointerDown(event) {
    if (feedSwipePhase !== "idle") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest?.(INTERACTIVE_SELECTOR)) return;
    swipeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: event.currentTarget.getBoundingClientRect().width,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleFeedPointerMove(event) {
    const start = swipeStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;

    // Let vertical movement remain native page scrolling; only a horizontal
    // gesture moves the feed panel with the finger.
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
      swipeStartRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      return;
    }
    if (Math.abs(deltaX) < 4) return;

    setFeedSwipePhase("dragging");
    setFeedSwipeOffset(deltaX * SWIPE_DRAG_RESISTANCE);
  }

  function handleFeedPointerUp(event) {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    // A pointer event without coordinates yields NaN deltas, and every
    // comparison against NaN is false — so the distance guards below would fall
    // through and `deltaX < 0` would pick the backwards direction. Treat a
    // non-measurable gesture as no gesture.
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      resetFeedSwipe();
      return;
    }
    if (Math.abs(deltaX) < SWIPE_MIN_X || Math.abs(deltaY) > SWIPE_MAX_Y) {
      resetFeedSwipe();
      return;
    }

    const direction = deltaX < 0 ? 1 : -1;
    const ids = moduleTypes.map((type) => type.id);
    const activeIndex = ids.indexOf(activeType);
    const nextType = ids[(activeIndex + direction + ids.length) % ids.length];
    const travelDistance = Math.max(start.width, 1);

    // Suppress the synthetic click mobile browsers send after a completed
    // swipe, otherwise the departing card could open as it leaves the screen.
    swipeClickBlockUntilRef.current =
      Date.now() + FEED_SWIPE_CLICK_SUPPRESSION_MS;
    setFeedSwipePhase("exiting");
    setFeedSwipeOffset(direction * -travelDistance);
    scheduleFeedSwipe(() => {
      setActiveType(nextType);
      setNavigationError("");
      setFeedSwipePhase("preparing");
      setFeedSwipeOffset(direction * travelDistance);
      swipeFrameRef.current = window.requestAnimationFrame(() => {
        swipeFrameRef.current = null;
        setFeedSwipePhase("entering");
        setFeedSwipeOffset(0);
        scheduleFeedSwipe(
          () => setFeedSwipePhase("idle"),
          FEED_SWIPE_TRANSITION_MS,
        );
      });
    }, FEED_SWIPE_TRANSITION_MS);
  }

  function openCreateModal() {
    setCreateType(activeType === "all" ? null : activeType);
    setCreateModalOpen(true);
  }

  function renderCreateContent() {
    if (!createType) {
      return (
        <div className={styles.createPicker}>
          {moduleTypes
            .filter((type) => type.id !== "all")
            .map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => setCreateType(type.id)}
                className={cx(styles.modulePalette, styles.createPickerButton)}
                data-module-type={type.id}
              >
                {CREATE_LABEL_BY_TYPE[type.id]}
              </button>
            ))}
        </div>
      );
    }

    if (createType === "requests") {
      return (
        <RequestCreateForm
          roommates={roommates}
          onRequestsChange={handleRequestsChange}
          onSuccess={() => setCreateModalOpen(false)}
          onCancel={() => setCreateModalOpen(false)}
        />
      );
    }
    if (createType === "checklists") {
      return (
        <ChecklistCreateForm
          onChecklistsChange={handleChecklistsChange}
          onSuccess={() => setCreateModalOpen(false)}
          onCancel={() => setCreateModalOpen(false)}
        />
      );
    }
    if (createType === "tv") {
      return (
        <ShowCreateForm
          onShowsChange={handleShowsChange}
          onSuccess={() => setCreateModalOpen(false)}
          onCancel={() => setCreateModalOpen(false)}
        />
      );
    }
    return (
      <ActivityCreateForm
        onActivitiesChange={handleActivitiesChange}
        onSuccess={() => setCreateModalOpen(false)}
        onCancel={() => setCreateModalOpen(false)}
      />
    );
  }

  function renderModule(module, editTrigger) {
    const moduleTag = <ModuleTag module={module} />;
    if (module.type === "events") {
      return (
        <ProposeActivity
          activities={[module.payload]}
          onActivitiesChange={handleActivitiesChange}
          transitioningId={transitioningId}
          onLiveTransition={handleLiveTransition}
          roommates={roommates}
          moduleTag={moduleTag}
          editTrigger={editTrigger}
        />
      );
    }
    if (module.type === "requests") {
      return (
        <RequestFeature
          requests={[module.payload]}
          onRequestsChange={handleRequestsChange}
          roommates={roommates}
          moduleTag={moduleTag}
          editTrigger={editTrigger}
        />
      );
    }
    if (module.type === "checklists") {
      return (
        <ChecklistFeature
          checklists={[module.payload]}
          onChecklistsChange={handleChecklistsChange}
          moduleTag={moduleTag}
          editTrigger={editTrigger}
        />
      );
    }
    if (module.type === "tv") {
      return (
        <ShowTrackerFeature
          shows={[module.payload]}
          onShowsChange={handleShowsChange}
          moduleTag={moduleTag}
          editTrigger={editTrigger}
        />
      );
    }
    return null;
  }

  const createTitle = createType
    ? CREATE_LABEL_BY_TYPE[createType]
    : "Create a module";
  const activeTypeLabel =
    moduleTypes.find((type) => type.id === activeType)?.label ?? "Modules";
  const createLabel =
    activeType === "all" ? "Create a module" : CREATE_LABEL_BY_TYPE[activeType];

  if (loading) {
    return <p className={styles.loading}>Loading the feed…</p>;
  }

  return (
    <section className={styles.feedSection}>
      {liveError && (
        <p className={cx("ui-errorBox", styles.pageError)}>{liveError}</p>
      )}
      {navigationError && (
        <p className={cx("ui-errorBox", styles.pageError)}>{navigationError}</p>
      )}

      <div className={styles.shell}>
        <ModuleNav
          activeType={activeType}
          modules={feedModules}
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

        <main
          className={styles.feedColumn}
          onPointerDown={handleFeedPointerDown}
          onPointerMove={handleFeedPointerMove}
          onPointerUp={handleFeedPointerUp}
          onClickCapture={handleFeedClickCapture}
          onPointerCancel={() => {
            swipeStartRef.current = null;
            resetFeedSwipe();
          }}
        >
          <div className={styles.feedViewport}>
            <div
              className={cx(
                styles.feedSlide,
                feedSwipePhase === "dragging" ||
                  feedSwipePhase === "preparing"
                  ? styles.feedSlideDirect
                  : "",
              )}
              style={{ transform: `translateX(${feedSwipeOffset}px)` }}
              data-feed-swipe-phase={feedSwipePhase}
            >
              <div className={styles.feedHeader}>
                <div>
                  <p className={styles.feedEyebrow}>Group feed</p>
                  <h2 className={styles.feedTitle}>{activeTypeLabel}</h2>
                </div>
                <div className={styles.feedHeaderActions}>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className={styles.feedFilterButton}
                    aria-label="Filter modules"
                  >
                    Filter
                  </button>
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className={styles.createInlineButton}
                    aria-label={createLabel}
                    title={createLabel}
                  >
                    +
                  </button>
                </div>
              </div>

          <div className={styles.feedList}>
            {activeModules.length === 0 ? (
              <p className={styles.emptyFeed}>No active modules here yet.</p>
            ) : (
              activeModules.map((module) => (
                <ModuleFeedItem
                  key={`${module.type}:${module.id}`}
                  module={module}
                  focusIntent={focusIntent}
                  onFocusHandled={consumeFocusIntent}
                  canEdit={module.isEditableBy(user.id)}
                  onEdit={() => setEditingModule(module)}
                >
                  {(editTrigger) => renderModule(module, editTrigger)}
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
                      focusIntent={focusIntent}
                      onFocusHandled={consumeFocusIntent}
                      canEdit={module.isEditableBy(user.id)}
                      onEdit={() => setEditingModule(module)}
                    >
                      {(editTrigger) => renderModule(module, editTrigger)}
                    </ModuleFeedItem>
                  ))}
                </div>
              )}
            </div>
          )}
            </div>
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
          title={MODULE_DEFINITIONS[editingModule.type].edit.label}
          onClose={() => setEditingModule(null)}
          widthClassName={styles.createModal}
        >
          <ModuleEditForm
            module={editingModule}
            roommates={roommates}
            onSaved={async () => {
              await loadFeed();
              setEditingModule(null);
            }}
            onCancel={() => setEditingModule(null)}
          />
        </ModalShell>
      )}
    </section>
  );
}

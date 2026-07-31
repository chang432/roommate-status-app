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
import PollCreateForm from "./PollCreateForm.jsx";
import PollFeature from "./PollFeature.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import ModuleEditForm from "./ModuleEditForm.jsx";
import ProposeActivity from "./ProposeActivity.jsx";
import RequestCreateForm from "./RequestCreateForm.jsx";
import RequestFeature from "./RequestFeature.jsx";
import ShowCreateForm from "./ShowCreateForm.jsx";
import ShowTrackerFeature from "./ShowTrackerFeature.jsx";
import BookClubMeetingFeature from "../book-club/BookClubMeetingFeature.jsx";
import BookClubMeetingForm from "../book-club/BookClubMeetingForm.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { ModuleFocusProvider } from "../../context/ModuleFocusContext.jsx";
import { endActivity, startActivity } from "../../api/activities.js";
import { getFeed } from "../../api/feed.js";
import {
  MODULE_TYPES,
  MODULE_DEFINITIONS,
  createModules,
} from "../../models/modules.js";
import { cx } from "../../utils/classNames.js";
import {
  moduleFocusFromSearchParams,
  withoutModuleFocus,
} from "../../utils/moduleFocus.js";
import { isAdminIn } from "../../utils/roles.js";
// The feed shares the status page's stylesheet — it renders inline beneath the
// status section on the same page.
import styles from "../../pages/StatusPage.module.css";

const FEED_POLL_INTERVAL_MS = 5000;
const MODULE_PREFERENCE_VERSION = 3;
const INTERACTIVE_SELECTOR = "button, a, input, textarea, select";
const SWIPE_MIN_X = 64;
const SWIPE_MAX_Y = 48;
const SWIPE_DRAG_RESISTANCE = 0.85;
const SWIPE_EDGE_RESISTANCE = 0.18;
const SWIPE_PANEL_GAP_PX = 16;
const FEED_SWIPE_TRANSITION_MS = 220;
const FEED_SWIPE_CLICK_SUPPRESSION_MS = FEED_SWIPE_TRANSITION_MS * 2;

function feedSwipeTransitionMs() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? 0
    : FEED_SWIPE_TRANSITION_MS;
}

const CREATE_LABEL_BY_TYPE = {
  events: "Create an event",
  requests: "Create a request",
  checklists: "Create a checklist",
  polls: "Create a poll",
  tv: "Add a show",
  "book-club": "Create a Book Club meeting",
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
    const allTypes = sanitizeAllTypes(stored?.allTypes, order);
    const version = stored?.version ?? 1;
    // Each newly introduced module is defaulted on exactly once; the version
    // marker preserves a user's later explicit deselection.
    if (version < 2 && !allTypes.includes("book-club")) {
      allTypes.push("book-club");
    }
    if (version < 3 && !allTypes.includes("polls")) allTypes.push("polls");
    return { order, allTypes };
  } catch {
    const order = sanitizeModuleOrder(null);
    return { order, allTypes: sanitizeAllTypes(null, order) };
  }
}

function getModuleCounts(modules, allTypes) {
  const counts = modules.reduce((result, module) => {
    if (!module.isArchived) {
      result[module.type] = (result[module.type] ?? 0) + 1;
    }
    return result;
  }, {});
  counts.all = modules.filter(
    (module) => !module.isArchived && allTypes.includes(module.type),
  ).length;
  return counts;
}

function ModuleTabs({
  activeType,
  counts,
  moduleTypes,
  onSelect,
  swipeOffset,
  swipePhase,
  swipeTravelDistance,
}) {
  const scrollerRef = useRef(null);
  const tabsRef = useRef(null);
  const tabRefs = useRef(new Map());
  const ribbonFrameRef = useRef(null);
  const [tabMetrics, setTabMetrics] = useState({});
  const activeIndex = moduleTypes.findIndex((type) => type.id === activeType);

  const categoryScrollTarget = useCallback((typeId) => {
    const scroller = scrollerRef.current;
    const tab = tabRefs.current.get(typeId);
    if (!scroller || !tab) return null;

    const centeredLeft =
      tab.offsetLeft - (scroller.clientWidth - tab.offsetWidth) / 2;
    const maxScrollLeft = Math.max(
      scroller.scrollWidth - scroller.clientWidth,
      0,
    );
    return Math.min(Math.max(centeredLeft, 0), maxScrollLeft);
  }, []);

  const cancelRibbonAnimation = useCallback(() => {
    if (ribbonFrameRef.current === null) return;
    window.cancelAnimationFrame(ribbonFrameRef.current);
    ribbonFrameRef.current = null;
  }, []);

  const setRibbonScroll = useCallback((left) => {
    if (scrollerRef.current) scrollerRef.current.scrollLeft = left;
  }, []);

  const animateRibbonScroll = useCallback(
    (destination) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      cancelRibbonAnimation();

      const duration = feedSwipeTransitionMs();
      const startLeft = scroller.scrollLeft;
      if (!duration || Math.abs(destination - startLeft) < 0.5) {
        setRibbonScroll(destination);
        return;
      }

      let startTime = null;
      function advance(timestamp) {
        startTime ??= timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);
        const easedProgress = 1 - (1 - progress) ** 3;
        setRibbonScroll(
          startLeft + (destination - startLeft) * easedProgress,
        );
        if (progress < 1) {
          ribbonFrameRef.current = window.requestAnimationFrame(advance);
        } else {
          ribbonFrameRef.current = null;
          setRibbonScroll(destination);
        }
      }
      ribbonFrameRef.current = window.requestAnimationFrame(advance);
    },
    [cancelRibbonAnimation, setRibbonScroll],
  );

  const alignActiveTab = useCallback(
    ({ force = false, immediate = false } = {}) => {
      const scroller = scrollerRef.current;
      const tab = tabRefs.current.get(activeType);
      if (!scroller || !tab) return;

      const tabStart = tab.offsetLeft;
      const tabEnd = tabStart + tab.offsetWidth;
      const visibleStart = scroller.scrollLeft;
      const visibleEnd = visibleStart + scroller.clientWidth;
      if (
        !force &&
        tabStart >= visibleStart &&
        tabEnd <= visibleEnd
      ) {
        return;
      }

      // Center middle categories while allowing the first and last positions
      // to remain anchored to their nearest ribbon edge.
      const left = categoryScrollTarget(activeType);
      if (left === null) return;
      const prefersReducedMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const behavior =
        immediate || prefersReducedMotion ? "auto" : "smooth";
      if (scroller.scrollTo) scroller.scrollTo({ left, behavior });
      else scroller.scrollLeft = left;
    },
    [activeType, categoryScrollTarget],
  );

  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return undefined;

    function measureTabs() {
      const tabsRect = tabs.getBoundingClientRect();
      const nextMetrics = {};
      tabRefs.current.forEach((tab, typeId) => {
        const content = tab.querySelector("[data-feed-tab-content]");
        if (!content) return;
        const contentRect = content.getBoundingClientRect();
        nextMetrics[typeId] = {
          left: contentRect.left - tabsRect.left,
          width: contentRect.width,
        };
      });
      setTabMetrics(nextMetrics);
    }

    measureTabs();
    window.addEventListener("resize", measureTabs);
    const observer = window.ResizeObserver
      ? new window.ResizeObserver(measureTabs)
      : null;
    observer?.observe(tabs);
    tabRefs.current.forEach((tab) => observer?.observe(tab));
    return () => {
      window.removeEventListener("resize", measureTabs);
      observer?.disconnect();
    };
  }, [counts, moduleTypes]);

  useEffect(() => {
    alignActiveTab();
  }, [activeType, alignActiveTab, moduleTypes]);

  useLayoutEffect(() => {
    const activeTarget = categoryScrollTarget(activeType);
    if (activeTarget === null) return;
    const adjacentType =
      swipeOffset < 0
        ? moduleTypes[activeIndex + 1]?.id
        : moduleTypes[activeIndex - 1]?.id;
    const adjacentTarget =
      categoryScrollTarget(adjacentType) ?? activeTarget;

    if (swipePhase === "dragging") {
      cancelRibbonAnimation();
      const progress = Math.min(
        Math.abs(swipeOffset) / Math.max(swipeTravelDistance, 1),
        1,
      );
      // Mirror the page track's normalized drag so the selected category
      // travels with the reader's finger instead of jumping after release.
      setRibbonScroll(
        activeTarget + (adjacentTarget - activeTarget) * progress,
      );
    } else if (swipePhase === "exiting") {
      animateRibbonScroll(adjacentTarget);
    } else if (swipePhase === "settling") {
      animateRibbonScroll(activeTarget);
    } else if (swipePhase === "preparing") {
      cancelRibbonAnimation();
      setRibbonScroll(activeTarget);
    }
  }, [
    activeIndex,
    activeType,
    animateRibbonScroll,
    cancelRibbonAnimation,
    categoryScrollTarget,
    moduleTypes,
    setRibbonScroll,
    swipeOffset,
    swipePhase,
    swipeTravelDistance,
  ]);

  useEffect(() => cancelRibbonAnimation, [cancelRibbonAnimation]);

  function handleKeyDown(event, index) {
    let nextIndex = null;
    if (event.key === "ArrowRight") nextIndex = Math.min(index + 1, moduleTypes.length - 1);
    if (event.key === "ArrowLeft") nextIndex = Math.max(index - 1, 0);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = moduleTypes.length - 1;
    if (nextIndex === null || nextIndex === index) return;

    event.preventDefault();
    const nextType = moduleTypes[nextIndex].id;
    onSelect(nextType);
    tabRefs.current.get(nextType)?.focus();
  }

  const adjacentType =
    swipeOffset < 0
      ? moduleTypes[activeIndex + 1]?.id
      : moduleTypes[activeIndex - 1]?.id;
  const activeMetric = tabMetrics[activeType];
  const adjacentMetric = tabMetrics[adjacentType];
  const progress = adjacentMetric
    ? Math.min(Math.abs(swipeOffset) / Math.max(swipeTravelDistance, 1), 1)
    : 0;
  // The underline follows the same normalized distance as the feed page, so
  // it stays attached to the reader's finger through differently sized tabs.
  const indicator = activeMetric
    ? {
        left:
          activeMetric.left +
          ((adjacentMetric?.left ?? activeMetric.left) - activeMetric.left) *
            progress,
        width:
          activeMetric.width +
          ((adjacentMetric?.width ?? activeMetric.width) -
            activeMetric.width) *
            progress,
      }
    : { left: 0, width: 0 };

  return (
    <div
      ref={scrollerRef}
      className={styles.feedCategoryScroller}
      data-feed-category-scroller
    >
      <div
        ref={tabsRef}
        className={styles.feedCategoryTabs}
        role="tablist"
        aria-label="Feed categories"
      >
        {moduleTypes.map((type, index) => (
          <button
            key={type.id}
            ref={(element) => {
              if (element) tabRefs.current.set(type.id, element);
              else tabRefs.current.delete(type.id);
            }}
            type="button"
            role="tab"
            id={`feed-tab-${type.id}`}
            aria-controls={`feed-panel-${type.id}`}
            aria-selected={activeType === type.id}
            tabIndex={activeType === type.id ? 0 : -1}
            onClick={() => onSelect(type.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cx(
              styles.feedCategoryTab,
              type.id === "all" ? "" : styles.modulePalette,
              activeType === type.id ? styles.feedCategoryTabActive : "",
            )}
            data-module-type={type.id === "all" ? undefined : type.id}
          >
            <span
              className={styles.feedCategoryTabContent}
              data-feed-tab-content
            >
              <span>{type.label}</span>
              <span className={styles.feedCategoryCount}>
                {counts[type.id] ?? 0}
              </span>
            </span>
          </button>
        ))}
        <span
          aria-hidden="true"
          className={cx(
            styles.feedCategoryIndicator,
            swipePhase === "dragging" || swipePhase === "preparing"
              ? styles.feedCategoryIndicatorDirect
              : "",
          )}
          style={{
            transform: `translate3d(${indicator.left}px, 0, 0)`,
            width: `${indicator.width}px`,
            opacity: indicator.width > 0 ? 1 : 0,
          }}
          data-feed-category-indicator
        />
      </div>
    </div>
  );
}

function ModuleNav({
  activeType,
  counts,
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
        id="group-feed-menu"
        ref={navRef}
        className={cx(styles.moduleNav, drawerOpen ? styles.moduleNavOpen : "")}
        aria-label="Module types"
        aria-hidden={!drawerOpen}
        inert={drawerOpen ? undefined : ""}
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
      <article ref={itemRef} className={styles.moduleItem}>
        {children(canEdit ? onEdit : null)}
      </article>
    </ModuleFocusProvider>
  );
}

// The group feed, rendered inline below the status section. Owns its own feed
// polling and create/filter UI; `roommates` come from the parent status page so
// we don't double-fetch the household.
export default function GroupFeed({
  roommates,
  onLoadStateChange,
  showStandardModules = true,
  showBookClub = false,
}) {
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
  const feedShellRef = useRef(null);
  const stickyHeaderRef = useRef(null);
  const categoryScrollPositionsRef = useRef(new Map());
  const pendingCategoryScrollRef = useRef(null);
  const [feedSwipeOffset, setFeedSwipeOffset] = useState(0);
  const [feedSwipePhase, setFeedSwipePhase] = useState("idle");
  const [feedSwipeTravelDistance, setFeedSwipeTravelDistance] = useState(1);
  const [feedHeaderStuck, setFeedHeaderStuck] = useState(false);
  const canAdministerBookClub = isAdminIn(roommates, user.id);

  const enabledTypeIds = useMemo(() => {
    const ids = new Set();
    if (showStandardModules) {
      ["events", "requests", "checklists", "tv"].forEach((id) => ids.add(id));
    }
    if (showBookClub) ids.add("book-club");
    if (showStandardModules || showBookClub) ids.add("polls");
    return ids;
  }, [showBookClub, showStandardModules]);

  const moduleTypes = useMemo(() => {
    const byId = new Map(MODULE_TYPES.map((type) => [type.id, type]));
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
    window.addEventListener("roomie:book-club-changed", loadFeed);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    navigator.serviceWorker?.addEventListener(
      "message",
      handleServiceWorkerMessage,
    );

    return () => {
      stopPolling();
      window.removeEventListener("focus", loadFeed);
      window.removeEventListener("roomie:book-club-changed", loadFeed);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      navigator.serviceWorker?.removeEventListener(
        "message",
        handleServiceWorkerMessage,
      );
    };
  }, [loadFeed]);

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
  const activeTypeIndex = moduleTypes.findIndex(
    (type) => type.id === activeType,
  );
  const previousType = moduleTypes[activeTypeIndex - 1]?.id ?? null;
  const nextType = moduleTypes[activeTypeIndex + 1]?.id ?? null;
  const showAdjacentPanels = feedSwipePhase !== "idle";

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

  useEffect(() => {
    if (loading) return undefined;
    const header = stickyHeaderRef.current;
    if (!header) return undefined;
    let frameId = null;

    function updateStickyState() {
      frameId = null;
      setFeedHeaderStuck(
        window.scrollY > 0 && header.getBoundingClientRect().top <= 0,
      );
    }

    function scheduleStickyUpdate() {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(updateStickyState);
    }

    updateStickyState();
    window.addEventListener("scroll", scheduleStickyUpdate, { passive: true });
    window.addEventListener("resize", scheduleStickyUpdate);
    return () => {
      window.removeEventListener("scroll", scheduleStickyUpdate);
      window.removeEventListener("resize", scheduleStickyUpdate);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [loading]);

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
  const handlePollsChange = useCallback(() => loadFeed(), [loadFeed]);
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

  function changeModuleType(type) {
    if (type === activeType) return;

    const shell = feedShellRef.current;
    if (shell) {
      const shellTop = shell.getBoundingClientRect().top + window.scrollY;
      const hasEnteredFeed = window.scrollY >= shellTop - 1;
      const destinationWasVisited = categoryScrollPositionsRef.current.has(type);

      if (hasEnteredFeed) {
        categoryScrollPositionsRef.current.set(
          activeType,
          Math.max(window.scrollY - shellTop, 0),
        );
      }
      if (hasEnteredFeed || destinationWasVisited) {
        // Restore after the destination panel commits so a shorter page cannot
        // clamp the old category's scroll position between renders.
        pendingCategoryScrollRef.current = {
          type,
          offset: categoryScrollPositionsRef.current.get(type) ?? 0,
        };
      }
    }

    setActiveType(type);
    setNavigationError("");
  }

  function selectModuleType(type) {
    swipeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    swipeTimersRef.current = [];
    if (swipeFrameRef.current !== null) {
      window.cancelAnimationFrame(swipeFrameRef.current);
      swipeFrameRef.current = null;
    }
    swipeStartRef.current = null;
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

  function resetFeedSwipe() {
    if (feedSwipePhase === "idle") return;
    setFeedSwipePhase("settling");
    setFeedSwipeOffset(0);
    scheduleFeedSwipe(() => setFeedSwipePhase("idle"), feedSwipeTransitionMs());
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
    const panelWidth = event.currentTarget.getBoundingClientRect().width;
    swipeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: panelWidth,
    };
    setFeedSwipeTravelDistance(
      Math.max(panelWidth + SWIPE_PANEL_GAP_PX, 1),
    );
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

    const direction = deltaX < 0 ? 1 : -1;
    const hasAdjacentType = direction > 0 ? Boolean(nextType) : Boolean(previousType);
    setFeedSwipePhase("dragging");
    setFeedSwipeOffset(
      deltaX *
        (hasAdjacentType ? SWIPE_DRAG_RESISTANCE : SWIPE_EDGE_RESISTANCE),
    );
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
    if (Math.abs(deltaX) >= 4 && Math.abs(deltaX) > Math.abs(deltaY)) {
      swipeClickBlockUntilRef.current =
        Date.now() + FEED_SWIPE_CLICK_SUPPRESSION_MS;
    }
    if (Math.abs(deltaX) < SWIPE_MIN_X || Math.abs(deltaY) > SWIPE_MAX_Y) {
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
    scheduleFeedSwipe(() => {
      // Once the adjacent page has arrived, promote it to the centered panel
      // without animation so there is no visual jump or duplicated entrance.
      changeModuleType(destinationType);
      setFeedSwipePhase("preparing");
      setFeedSwipeOffset(0);
      swipeFrameRef.current = window.requestAnimationFrame(() => {
        swipeFrameRef.current = null;
        setFeedSwipePhase("idle");
      });
    }, feedSwipeTransitionMs());
  }

  function openCreateModal() {
    if (activeType === "book-club" && !canAdministerBookClub) return;
    setCreateType(activeType === "all" ? null : activeType);
    setCreateModalOpen(true);
  }

  function renderCreateContent() {
    if (!createType) {
      return (
        <div className={styles.createPicker}>
          {moduleTypes
            .filter((type) => type.id !== "all")
            .filter((type) => type.id !== "book-club" || canAdministerBookClub)
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
    if (createType === "polls") {
      return (
        <PollCreateForm
          onPollsChange={handlePollsChange}
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
    if (createType === "book-club") {
      return (
        <BookClubMeetingForm
          roommates={roommates}
          onSaved={async () => {
            await loadFeed();
            setCreateModalOpen(false);
          }}
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

  function renderModule(module, onEdit) {
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
          onEdit={onEdit}
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
          onEdit={onEdit}
        />
      );
    }
    if (module.type === "checklists") {
      return (
        <ChecklistFeature
          checklists={[module.payload]}
          onChecklistsChange={handleChecklistsChange}
          moduleTag={moduleTag}
          onEdit={onEdit}
        />
      );
    }
    if (module.type === "polls") {
      return (
        <PollFeature
          polls={[module.payload]}
          roommates={roommates}
          onPollsChange={handlePollsChange}
          moduleTag={moduleTag}
          onEdit={onEdit}
        />
      );
    }
    if (module.type === "tv") {
      return (
        <ShowTrackerFeature
          shows={[module.payload]}
          onShowsChange={handleShowsChange}
          moduleTag={moduleTag}
          onEdit={onEdit}
        />
      );
    }
    if (module.type === "book-club") {
      return (
        <BookClubMeetingFeature
          meetings={[module.payload]}
          moduleTag={moduleTag}
          onEdit={onEdit}
          canAdminister={canAdministerBookClub}
          onChanged={loadFeed}
        />
      );
    }
    return null;
  }

  function renderFeedPanel(type, isActivePanel) {
    const visibleModules =
      type === "all"
        ? feedModules.filter((module) => allTypes.includes(module.type))
        : feedModules.filter((module) => module.type === type);
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
                canEdit={
                  module.type === "book-club"
                    ? false
                    : module.isEditableBy(user.id)
                }
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
                    canEdit={
                      module.type === "book-club"
                        ? false
                        : module.isEditableBy(user.id)
                    }
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
    ? CREATE_LABEL_BY_TYPE[createType]
    : "Create a module";
  const createLabel =
    activeType === "all" ? "Create a module" : CREATE_LABEL_BY_TYPE[activeType];
  const canCreateModule = showStandardModules || showBookClub;

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
          className={cx(
            styles.feedStickyHeader,
            feedHeaderStuck ? styles.feedStickyHeaderStuck : "",
          )}
          data-feed-sticky-header
        >
          <div className={styles.feedHeader}>
            <h2 className={styles.feedTitle}>Group Feed</h2>
            {canCreateModule &&
              (activeType !== "book-club" || canAdministerBookClub) && (
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
          <div className={styles.feedCategoryRow}>
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
          onPointerDown={handleFeedPointerDown}
          onPointerMove={handleFeedPointerMove}
          onPointerUp={handleFeedPointerUp}
          onClickCapture={handleFeedClickCapture}
          onPointerCancel={() => {
            swipeStartRef.current = null;
            resetFeedSwipe();
          }}
        >
          <div
            className={styles.feedViewport}
            data-feed-swipe-phase={feedSwipePhase}
          >
            {showAdjacentPanels && previousType ? (
              <div
                className={cx(
                  styles.feedPanel,
                  styles.feedPanelAdjacent,
                  feedSwipePhase === "dragging" ||
                    feedSwipePhase === "preparing"
                    ? styles.feedPanelDirect
                    : "",
                )}
                style={{
                  transform: `translate3d(calc(-100% - ${SWIPE_PANEL_GAP_PX}px + ${feedSwipeOffset}px), 0, 0)`,
                }}
                data-feed-panel-type={previousType}
                aria-hidden="true"
                inert=""
              >
                {renderFeedPanel(previousType, false)}
              </div>
            ) : null}

            <div
              id={`feed-panel-${activeType}`}
              role="tabpanel"
              aria-labelledby={`feed-tab-${activeType}`}
              className={cx(
                styles.feedPanel,
                feedSwipePhase === "dragging" ||
                  feedSwipePhase === "preparing"
                  ? styles.feedPanelDirect
                  : "",
              )}
              style={{
                transform: `translate3d(${feedSwipeOffset}px, 0, 0)`,
              }}
              data-feed-panel-type={activeType}
            >
              {renderFeedPanel(activeType, true)}
            </div>

            {showAdjacentPanels && nextType ? (
              <div
                className={cx(
                  styles.feedPanel,
                  styles.feedPanelAdjacent,
                  feedSwipePhase === "dragging" ||
                    feedSwipePhase === "preparing"
                    ? styles.feedPanelDirect
                    : "",
                )}
                style={{
                  transform: `translate3d(calc(100% + ${SWIPE_PANEL_GAP_PX}px + ${feedSwipeOffset}px), 0, 0)`,
                }}
                data-feed-panel-type={nextType}
                aria-hidden="true"
                inert=""
              >
                {renderFeedPanel(nextType, false)}
              </div>
            ) : null}
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
          {editingModule.type === "book-club" ? (
            <BookClubMeetingForm
              meeting={editingModule.payload}
              roommates={roommates}
              onSaved={async () => {
                await loadFeed();
                setEditingModule(null);
              }}
              onCancel={() => setEditingModule(null)}
            />
          ) : (
            <ModuleEditForm
              module={editingModule}
              roommates={roommates}
              onSaved={async () => {
                await loadFeed();
                setEditingModule(null);
              }}
              onCancel={() => setEditingModule(null)}
            />
          )}
        </ModalShell>
      )}
    </section>
  );
}

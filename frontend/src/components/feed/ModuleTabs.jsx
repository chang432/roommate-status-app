import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx } from "../../utils/classNames.js";
import styles from "./GroupFeed.module.css";

const FEED_SWIPE_TRANSITION_MS = 220;

function feedSwipeTransitionMs() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? 0
    : FEED_SWIPE_TRANSITION_MS;
}

export default function ModuleTabs({
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

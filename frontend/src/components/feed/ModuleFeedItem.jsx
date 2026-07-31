import { useEffect, useRef } from "react";
import { ModuleFocusProvider } from "../../context/ModuleFocusContext.jsx";
import { cx } from "../../utils/classNames.js";
import { FEED_MODULE_REGISTRY } from "./feedModuleRegistry.jsx";
import styles from "./GroupFeed.module.css";

export function ModuleTag({ module }) {
  const definition = FEED_MODULE_REGISTRY[module.type];
  return (
    <span
      className={cx(styles.modulePalette, styles.moduleType)}
      data-module-type={module.type}
    >
      {definition?.shortLabel ?? module.type}
    </span>
  );
}

export default function ModuleFeedItem({
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

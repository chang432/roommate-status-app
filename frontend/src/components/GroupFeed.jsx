import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ActivityCreateForm from "./ActivityCreateForm.jsx";
import ChecklistCreateForm from "./ChecklistCreateForm.jsx";
import ChecklistFeature from "./ChecklistFeature.jsx";
import JamWidget, { JamShareForm } from "./JamWidget.jsx";
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
  moduleTagStyle,
  modulePanelStyle,
} from "../models/modules.js";
import { cx } from "../utils/classNames.js";
import {
  moduleFocusFromSearchParams,
  withoutModuleFocus,
} from "../utils/moduleFocus.js";
// The feed shares the status page's stylesheet — it renders inline beneath the
// status section on the same page.
import styles from "../pages/StatusPage.module.css";

const FEED_POLL_INTERVAL_MS = 5000;

const CREATE_LABEL_BY_TYPE = {
  events: "Create an event",
  requests: "Create a request",
  checklists: "Create a checklist",
  tv: "Add a show",
  spotify: "Share Spotify Jam",
};

function ModuleNav({ activeType, modules, drawerOpen, onClose, onSelect }) {
  const counts = modules.reduce((acc, module) => {
    if (module.isArchived) return acc;
    acc[module.type] = (acc[module.type] ?? 0) + 1;
    acc.all = (acc.all ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close module list"
          className={styles.drawerBackdrop}
          onClick={onClose}
        />
      ) : null}
      <aside
        className={cx(styles.moduleNav, drawerOpen ? styles.moduleNavOpen : "")}
        aria-label="Module types"
      >
        <div className={styles.moduleNavHeader}>
          <p className={styles.moduleNavEyebrow}>Modules</p>
          <button
            type="button"
            className={styles.moduleNavClose}
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className={styles.moduleNavList}>
          {MODULE_TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => onSelect(type.id)}
              className={cx(
                styles.moduleNavItem,
                activeType === type.id ? styles.moduleNavItemActive : "",
              )}
            >
              <span>{type.label}</span>
              <span className={styles.moduleNavCount}>{counts[type.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}

function ModuleTag({ module }) {
  return (
    <span className={styles.moduleType} style={moduleTagStyle(module.type)}>
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
        {canEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className={styles.moduleEditButton}
            aria-label={MODULE_DEFINITIONS[module.type].edit.label}
          >
            Edit
          </button>
        ) : null}
        {children}
      </article>
    </ModuleFocusProvider>
  );
}

// The group feed, rendered inline below the status section. Owns its own feed
// polling and create/filter UI; `roommates` come from the parent status page so
// we don't double-fetch the household.
export default function GroupFeed({ roommates }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [modules, setModules] = useState([]);
  const [activeType, setActiveType] = useState("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [liveError, setLiveError] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const [transitioningId, setTransitioningId] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState(null);
  const [jamModalOpen, setJamModalOpen] = useState(false);
  const [editingModule, setEditingModule] = useState(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const loadFeed = useCallback(async () => {
    try {
      setModules(createModules(await getFeed(user.id, "all")));
      setLiveError("");
    } catch {
      setLiveError("Could not load the group feed.");
    }
  }, [user.id]);

  useEffect(() => {
    loadFeed().finally(() => setLoading(false));
  }, [loadFeed]);

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
    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);

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
        ? modules
        : modules.filter((module) => module.type === activeType),
    [activeType, modules],
  );
  const activeModules = useMemo(
    () => visibleModules.filter((module) => !module.isArchived),
    [visibleModules],
  );
  const archivedModules = useMemo(
    () => visibleModules.filter((module) => module.isArchived),
    [visibleModules],
  );

  // The active Spotify Jam (if any) rides along in the feed as its own module.
  const currentJam = useMemo(
    () => modules.find((module) => module.type === "spotify")?.payload ?? null,
    [modules],
  );

  const focusIntent = useMemo(
    () => moduleFocusFromSearchParams(searchParams),
    [searchParams],
  );
  const moduleTypeIds = useMemo(
    () =>
      new Set(
        MODULE_TYPES.filter((type) => type.id !== "all").map((type) => type.id),
      ),
    [],
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

  // Every mutation surfaces through the unified feed, so each change handler
  // just refreshes it.
  const handleActivitiesChange = useCallback(() => loadFeed(), [loadFeed]);
  const handleRequestsChange = useCallback(() => loadFeed(), [loadFeed]);
  const handleChecklistsChange = useCallback(() => loadFeed(), [loadFeed]);
  const handleShowsChange = useCallback(() => loadFeed(), [loadFeed]);
  const handleJamChange = useCallback(() => loadFeed(), [loadFeed]);

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

  function openCreateModal() {
    setCreateType(activeType === "all" ? null : activeType);
    setCreateModalOpen(true);
  }

  function renderCreateContent() {
    if (!createType) {
      return (
        <div className={styles.createPicker}>
          {MODULE_TYPES.filter((type) => type.id !== "all").map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => setCreateType(type.id)}
              className={styles.createPickerButton}
              style={modulePanelStyle(type.id)}
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
    if (createType === "spotify") {
      return (
        <JamShareForm
          currentJam={currentJam}
          onJamChange={handleJamChange}
          onSuccess={() => setCreateModalOpen(false)}
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

  function renderModule(module) {
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
        />
      );
    }
    if (module.type === "checklists") {
      return (
        <ChecklistFeature
          checklists={[module.payload]}
          onChecklistsChange={handleChecklistsChange}
          moduleTag={moduleTag}
        />
      );
    }
    if (module.type === "tv") {
      return (
        <ShowTrackerFeature
          shows={[module.payload]}
          onShowsChange={handleShowsChange}
          moduleTag={moduleTag}
        />
      );
    }
    if (module.type === "spotify") {
      return (
        <JamWidget
          jam={module.payload}
          onJamChange={handleJamChange}
          onReplace={() => setJamModalOpen(true)}
          canEdit={module.isEditableBy(user.id)}
          moduleTag={moduleTag}
        />
      );
    }
    return null;
  }

  const createTitle = createType
    ? CREATE_LABEL_BY_TYPE[createType]
    : "Create a module";
  const activeTypeLabel =
    MODULE_TYPES.find((type) => type.id === activeType)?.label ?? "Modules";
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
          modules={modules}
          drawerOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onSelect={selectModuleType}
        />

        <main className={styles.feedColumn}>
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
                  {renderModule(module)}
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
                      {renderModule(module)}
                    </ModuleFeedItem>
                  ))}
                </div>
              )}
            </div>
          )}
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
      {jamModalOpen && (
        <ModalShell
          title={currentJam ? "Replace Spotify Jam" : "Share Spotify Jam"}
          onClose={() => setJamModalOpen(false)}
          widthClassName={styles.jamModal}
        >
          <JamShareForm
            currentJam={currentJam}
            onJamChange={handleJamChange}
            onSuccess={() => setJamModalOpen(false)}
          />
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

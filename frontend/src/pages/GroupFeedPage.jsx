import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ActivityCreateForm from "../components/ActivityCreateForm.jsx";
import Brandmark from "../components/Brandmark.jsx";
import ChecklistCreateForm from "../components/ChecklistCreateForm.jsx";
import ChecklistFeature from "../components/ChecklistFeature.jsx";
import JamWidget, { JamShareForm } from "../components/JamWidget.jsx";
import ModalShell from "../components/ModalShell.jsx";
import ProfileSettings from "../components/ProfileSettings.jsx";
import ProposeActivity from "../components/ProposeActivity.jsx";
import PullToRefreshIndicator from "../components/PullToRefreshIndicator.jsx";
import RequestCreateForm from "../components/RequestCreateForm.jsx";
import RequestFeature from "../components/RequestFeature.jsx";
import ShowCreateForm from "../components/ShowCreateForm.jsx";
import ShowTrackerFeature from "../components/ShowTrackerFeature.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  endActivity,
  getActivities,
  getChecklists,
  getFeed,
  getJam,
  getRequests,
  getRoommates,
  getShows,
  startActivity,
} from "../api/client.js";
import { MODULE_TYPES, createModules } from "../models/modules.js";
import { cx } from "../utils/classNames.js";
import { usePullToRefresh } from "../utils/usePullToRefresh.js";
import styles from "./StatusPage.module.css";

const FEED_POLL_INTERVAL_MS = 5000;

const CREATE_LABEL_BY_TYPE = {
  events: "Create an event",
  requests: "Create a request",
  checklists: "Create a checklist",
  tv: "Add a show",
  spotify: "Share Spotify Jam",
};

function whenLabel() {
  const now = new Date();
  const day = now.toLocaleDateString(undefined, { weekday: "long" });
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `${day} ${part} · group feed`;
}

function ModuleNav({ activeType, modules, drawerOpen, onClose, onSelect }) {
  const counts = modules.reduce((acc, module) => {
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
        className={cx(
          styles.moduleNav,
          drawerOpen ? styles.moduleNavOpen : "",
        )}
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
              <span className={styles.moduleNavCount}>
                {counts[type.id] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}

function ModuleTag({ module }) {
  return <span className={styles.moduleType}>{module.typeLabel}</span>;
}

function ModuleFeedItem({ children }) {
  return <article className={styles.moduleItem}>{children}</article>;
}

export default function GroupFeedPage() {
  const { user, logout, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const feedEndRef = useRef(null);
  const touchStartX = useRef(null);

  const [roommates, setRoommates] = useState([]);
  const [, setActivities] = useState([]);
  const [, setRequests] = useState([]);
  const [, setChecklists] = useState([]);
  const [, setShows] = useState([]);
  const [jam, setJam] = useState(null);
  const [modules, setModules] = useState([]);
  const [activeType, setActiveType] = useState("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [liveError, setLiveError] = useState("");
  const [transitioningId, setTransitioningId] = useState(null);
  const [activityFocusRequest] = useState(null);
  const [requestFocusRequest, setRequestFocusRequest] = useState(null);
  const [checklistFocusRequest, setChecklistFocusRequest] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState(null);
  const [jamModalOpen, setJamModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadFeed = useCallback(async () => {
    try {
      setModules(createModules(await getFeed(user.id, "all")));
      setLiveError("");
    } catch {
      setLiveError("Could not load the group feed.");
    }
  }, [user.id]);

  const loadRoommates = useCallback(async () => {
    try {
      setRoommates(await getRoommates(user.id));
      setLiveError("");
    } catch {
      setLiveError("Could not load roommate statuses.");
    }
  }, [user.id]);

  const loadActivities = useCallback(async () => {
    try {
      setActivities(await getActivities(user.id));
      setLiveError("");
    } catch {
      setLiveError("Could not load household events.");
    }
  }, [user.id]);

  const loadRequests = useCallback(async () => {
    try {
      setRequests(await getRequests(user.id));
      setLiveError("");
    } catch {
      setLiveError("Could not load household requests.");
    }
  }, [user.id]);

  const loadChecklists = useCallback(async () => {
    try {
      setChecklists(await getChecklists(user.id));
      setLiveError("");
    } catch {
      setLiveError("Could not load household checklists.");
    }
  }, [user.id]);

  const loadJam = useCallback(async () => {
    try {
      setJam(await getJam(user.id));
      setLiveError("");
    } catch {
      setLiveError("Could not load the Spotify Jam.");
    }
  }, [user.id]);

  const loadShows = useCallback(async () => {
    try {
      setShows(await getShows(user.id));
      setLiveError("");
    } catch {
      setLiveError("Could not load the show tracker.");
    }
  }, [user.id]);

  const loadAll = useCallback(async () => {
    await Promise.all([
      loadRoommates(),
      loadActivities(),
      loadRequests(),
      loadChecklists(),
      loadJam(),
      loadShows(),
      loadFeed(),
    ]);
  }, [
    loadActivities,
    loadChecklists,
    loadFeed,
    loadJam,
    loadRequests,
    loadRoommates,
    loadShows,
  ]);

  useEffect(() => {
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

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

    function handleServiceWorkerMessage(event) {
      if (event.data?.type === "activities-changed") loadActivities();
      if (event.data?.type === "requests-changed") loadRequests();
      if (event.data?.type === "checklists-changed") loadChecklists();
      if (event.data?.type === "jam-changed") loadJam();
      if (event.data?.type === "shows-changed") loadShows();
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
  }, [loadActivities, loadChecklists, loadFeed, loadJam, loadRequests, loadShows]);

  const { pull, refreshing, threshold } = usePullToRefresh(loadAll);

  const visibleModules = useMemo(
    () =>
      activeType === "all"
        ? modules
        : modules.filter((module) => module.type === activeType),
    [activeType, modules],
  );

  useEffect(() => {
    const requestId = searchParams.get("request");
    if (!requestId) return;
    setActiveType("requests");
    setRequestFocusRequest((current) => ({
      requestId,
      requestKey: (current?.requestKey ?? 0) + 1,
    }));
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("request");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const checklistId = searchParams.get("checklist");
    if (!checklistId) return;
    setActiveType("checklists");
    setChecklistFocusRequest((current) => ({
      checklistId,
      requestKey: (current?.requestKey ?? 0) + 1,
    }));
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("checklist");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (loading) return;
    feedEndRef.current?.scrollIntoView({ block: "end" });
  }, [loading]);

  useEffect(() => {
    if (!drawerOpen) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") setDrawerOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  const handleActivitiesChange = useCallback(
    (updated) => {
      setActivities(updated);
      loadFeed();
    },
    [loadFeed],
  );

  const handleRequestsChange = useCallback(
    (updated) => {
      setRequests(updated);
      loadFeed();
    },
    [loadFeed],
  );

  const handleChecklistsChange = useCallback(
    (updated) => {
      setChecklists(updated);
      loadFeed();
    },
    [loadFeed],
  );

  const handleShowsChange = useCallback(
    (updated) => {
      setShows(updated);
      loadFeed();
    },
    [loadFeed],
  );

  const handleJamChange = useCallback(
    (updated) => {
      setJam(updated);
      loadFeed();
    },
    [loadFeed],
  );

  async function handleLiveTransition(activity, action) {
    if (transitioningId) return;
    setTransitioningId(activity.id);
    setLiveError("");
    try {
      const transition = action === "start" ? startActivity : endActivity;
      handleActivitiesChange(await transition(activity.id, user.id));
    } catch (err) {
      setLiveError(err.message || `Could not ${action} the event. Try again.`);
    } finally {
      setTransitioningId(null);
    }
  }

  function selectModuleType(type) {
    setActiveType(type);
    setDrawerOpen(false);
  }

  function openCreateModal() {
    setCreateType(activeType === "all" ? null : activeType);
    setCreateModalOpen(true);
  }

  function handleTouchStart(event) {
    const touch = event.touches[0];
    touchStartX.current = touch?.clientX < 32 ? touch.clientX : null;
  }

  function handleTouchEnd(event) {
    if (touchStartX.current === null) return;
    const touch = event.changedTouches[0];
    if (touch && touch.clientX - touchStartX.current > 72) setDrawerOpen(true);
    touchStartX.current = null;
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
          currentJam={jam}
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
          activityFocusRequest={activityFocusRequest}
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
          requestFocusRequest={requestFocusRequest}
          moduleTag={moduleTag}
        />
      );
    }
    if (module.type === "checklists") {
      return (
        <ChecklistFeature
          checklists={[module.payload]}
          onChecklistsChange={handleChecklistsChange}
          checklistFocusRequest={checklistFocusRequest}
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

  return (
    <>
      <PullToRefreshIndicator
        pull={pull}
        refreshing={refreshing}
        threshold={threshold}
      />

      <div
        className={styles.page}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: pull > 0 && !refreshing ? "none" : "transform 260ms ease",
        }}
      >
        <header className={styles.header}>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className={styles.moduleMenuButton}
            aria-label="Open module list"
          >
            <span className={styles.moduleMenuIcon} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
          <Brandmark
            className={styles.brandmark}
            iconClassName={styles.brandmarkIcon}
          />
          <div className={styles.headerText}>
            <h1 className={styles.title}>Yorkshire Group Feed</h1>
            <p className={styles.subtitle}>{whenLabel()}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/")}
            className={styles.statusRouteButton}
          >
            Status
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open profile settings"
            className={styles.profileButton}
          >
            <span className={styles.profileInitial} aria-hidden="true">
              {(user.name || user.username || "?").slice(0, 1).toUpperCase()}
            </span>
            <span className={styles.profileLabel}>Settings</span>
          </button>
        </header>

        {loading ? (
          <p className={styles.loading}>Loading the feed…</p>
        ) : (
          <div className={styles.shell}>
            <ModuleNav
              activeType={activeType}
              modules={modules}
              drawerOpen={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              onSelect={selectModuleType}
            />

            <main className={styles.feedColumn}>
              {liveError && (
                <p className={cx("ui-errorBox", styles.pageError)}>{liveError}</p>
              )}

              <section className={styles.feedSection}>
                <div className={styles.feedHeader}>
                  <div>
                    <p className={styles.feedEyebrow}>Group feed</p>
                    <h2 className={styles.feedTitle}>{activeTypeLabel}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className={cx("ui-primaryButton", styles.createButton)}
                  >
                    {activeType === "all"
                      ? "New module"
                      : CREATE_LABEL_BY_TYPE[activeType]}
                  </button>
                </div>

                <div className={styles.feedList}>
                  {visibleModules.length === 0 ? (
                    <p className={styles.emptyFeed}>No active modules here yet.</p>
                  ) : (
                    visibleModules.map((module) => (
                      <ModuleFeedItem key={`${module.type}:${module.id}`}>
                        {renderModule(module)}
                      </ModuleFeedItem>
                    ))
                  )}
                  <div ref={feedEndRef} />
                </div>
              </section>
            </main>
          </div>
        )}

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
            title={jam ? "Replace Spotify Jam" : "Share Spotify Jam"}
            onClose={() => setJamModalOpen(false)}
            widthClassName={styles.jamModal}
          >
            <JamShareForm
              currentJam={jam}
              onJamChange={handleJamChange}
              onSuccess={() => setJamModalOpen(false)}
            />
          </ModalShell>
        )}
        {settingsOpen && (
          <ModalShell
            title="Profile settings"
            onClose={() => setSettingsOpen(false)}
            widthClassName={styles.settingsModal}
          >
            <ProfileSettings
              user={user}
              onSignOut={logout}
              onDeleteAccount={deleteAccount}
            />
          </ModalShell>
        )}
      </div>
    </>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Brandmark from "../components/Brandmark.jsx";
import EnableNotifications from "../components/EnableNotifications.jsx";
import LiveEventBanner from "../components/LiveEventBanner.jsx";
import ModalShell from "../components/ModalShell.jsx";
import NotificationBanner from "../components/NotificationBanner.jsx";
import ProfileSettings from "../components/ProfileSettings.jsx";
import PullToRefreshIndicator from "../components/PullToRefreshIndicator.jsx";
import StatusCard from "../components/StatusCard.jsx";
import YouCard from "../components/YouCard.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  endActivity,
  getActivities,
  getRoommates,
  notifyRoommatesToUpdateStatus,
  pokeRoommate,
  startActivity,
  updateStatus,
} from "../api/client.js";
import { avatarColor } from "../utils/avatar.js";
import { cx } from "../utils/classNames.js";
import { usePullToRefresh } from "../utils/usePullToRefresh.js";
import {
  AVAILABLE_THRESHOLD,
  availableCount,
  decorateRoommatesWithActivityStatus,
} from "../utils/status.js";
import styles from "./StatusPage.module.css";

const ACTIVITY_POLL_INTERVAL_MS = 5000;

function whenLabel() {
  const now = new Date();
  const day = now.toLocaleDateString(undefined, { weekday: "long" });
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `${day} ${part} · status board`;
}

export default function StatusPage() {
  const { user, logout, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const ownCardRef = useRef(null);
  const touchStartX = useRef(null);

  const [roommates, setRoommates] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [transitioningId, setTransitioningId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notifyingHousehold, setNotifyingHousehold] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadRoommates = useCallback(async () => {
    try {
      setRoommates(await getRoommates(user.id));
      setError("");
    } catch {
      setError("Could not load roommate statuses.");
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

  const loadAll = useCallback(async () => {
    await Promise.all([loadRoommates(), loadActivities()]);
  }, [loadActivities, loadRoommates]);

  useEffect(() => {
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  useEffect(() => {
    let pollId = null;

    function startPolling() {
      if (pollId !== null || document.visibilityState !== "visible") return;
      pollId = window.setInterval(loadActivities, ACTIVITY_POLL_INTERVAL_MS);
    }

    function stopPolling() {
      if (pollId === null) return;
      window.clearInterval(pollId);
      pollId = null;
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        loadActivities();
        startPolling();
      } else {
        stopPolling();
      }
    }

    function handleServiceWorkerMessage(event) {
      if (event.data?.type === "activities-changed") loadActivities();
    }

    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    navigator.serviceWorker?.addEventListener(
      "message",
      handleServiceWorkerMessage,
    );

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      navigator.serviceWorker?.removeEventListener(
        "message",
        handleServiceWorkerMessage,
      );
    };
  }, [loadActivities]);

  const { pull, refreshing, threshold } = usePullToRefresh(loadAll);

  const displayedRoommates = useMemo(
    () => decorateRoommatesWithActivityStatus(roommates, activities),
    [activities, roommates],
  );

  const { me, meIndex, others } = useMemo(() => {
    const idx = displayedRoommates.findIndex((r) => r.id === user.id);
    return {
      me: displayedRoommates[idx] ?? null,
      meIndex: idx,
      others: displayedRoommates.filter((r) => r.id !== user.id),
    };
  }, [displayedRoommates, user.id]);

  const freeCount = availableCount(displayedRoommates);
  const showBanner = freeCount >= AVAILABLE_THRESHOLD;
  const liveEvents = activities.filter((activity) => activity.isLive);

  useEffect(() => {
    const feedParams = new URLSearchParams(searchParams);
    feedParams.delete("updateStatus");
    if (!feedParams.toString()) return;
    navigate(`/feed?${feedParams.toString()}`, { replace: true });
  }, [navigate, searchParams]);

  useEffect(() => {
    if (!me || searchParams.get("updateStatus") !== "1") return;
    setEditing(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("updateStatus");
    setSearchParams(nextParams, { replace: true });
    window.requestAnimationFrame(() => {
      ownCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [me, searchParams, setSearchParams]);

  const handleActivitiesChange = useCallback((updated) => {
    setActivities(updated);
  }, []);

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

  async function handleSave(status, statusText) {
    setSaving(true);
    setError("");
    try {
      const updated = await updateStatus(user.id, status, statusText);
      setRoommates(updated);
      setEditing(false);
    } catch {
      setError("Could not save your status. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleNotifyHousehold() {
    if (notifyingHousehold) return;
    setNotifyingHousehold(true);
    setError("");
    try {
      await notifyRoommatesToUpdateStatus(user.id);
    } catch {
      setError("Could not notify the shire. Try again.");
    } finally {
      setNotifyingHousehold(false);
    }
  }

  async function handlePokeRoommate(roommateId) {
    await pokeRoommate(roommateId, user.id);
  }

  function handleTouchStart(event) {
    const touch = event.touches[0];
    const rightEdge = window.innerWidth - 32;
    touchStartX.current = touch?.clientX > rightEdge ? touch.clientX : null;
  }

  function handleTouchEnd(event) {
    if (touchStartX.current === null) return;
    const touch = event.changedTouches[0];
    if (touch && touchStartX.current - touch.clientX > 72) navigate("/feed");
    touchStartX.current = null;
  }

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
          <Brandmark
            className={styles.brandmark}
            iconClassName={styles.brandmarkIcon}
          />
          <div className={styles.headerText}>
            <h1 className={styles.title}>Yorkshire Roomie Status</h1>
            <p className={styles.subtitle}>{whenLabel()}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/feed")}
            className={styles.feedRouteButton}
          >
            Feed
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

        <p className={styles.swipeHint}>Swipe in from the right edge for group feed.</p>

        {error && (
          <p className={cx("ui-errorBox", styles.pageError)}>{error}</p>
        )}

        {loading ? (
          <p className={styles.loading}>Loading the shire…</p>
        ) : (
          <main>
            {liveError && (
              <p className={cx("ui-errorBox", styles.pageError)}>{liveError}</p>
            )}

            {liveEvents.length > 0 && (
              <div className={styles.liveEvents}>
                {liveEvents.map((liveEvent) => (
                  <LiveEventBanner
                    key={liveEvent.id}
                    event={liveEvent}
                    canEnd={liveEvent.proposedById === user.id}
                    ending={transitioningId === liveEvent.id}
                    onEnd={() => handleLiveTransition(liveEvent, "end")}
                    user={user}
                    onBannerClick={() => navigate("/feed")}
                  />
                ))}
              </div>
            )}

            <EnableNotifications />
            {showBanner && <NotificationBanner count={freeCount} />}

            {me && (
              <div ref={ownCardRef} className={styles.ownCard}>
                <YouCard
                  roommate={me}
                  avatarColor={avatarColor(meIndex)}
                  editing={editing}
                  saving={saving}
                  onEdit={() => setEditing((v) => !v)}
                  onSave={handleSave}
                  onCancel={() => setEditing(false)}
                />
              </div>
            )}

            <div className={styles.householdHeader}>
              <p className={cx("ui-sectionLabel", styles.householdTitle)}>
                The Shire
              </p>
              <button
                type="button"
                onClick={handleNotifyHousehold}
                disabled={notifyingHousehold}
                aria-label="Notify all to update"
                title="Notify all to update"
                className={cx("ui-iconPrimary", styles.notifyButton)}
              >
                <img src="/megaphone.png" alt="" className={styles.notifyIcon} />
              </button>
            </div>
            <div className={styles.householdGrid}>
              {others.map((roommate) => (
                <StatusCard
                  key={roommate.id}
                  roommate={roommate}
                  onPoke={handlePokeRoommate}
                />
              ))}
            </div>
          </main>
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

import { useCallback, useEffect, useMemo, useState } from "react";
import Brandmark from "../components/Brandmark.jsx";
import YouCard from "../components/YouCard.jsx";
import StatusCard from "../components/StatusCard.jsx";
import NotificationBanner from "../components/NotificationBanner.jsx";
import LiveEventBanner from "../components/LiveEventBanner.jsx";
import EnableNotifications from "../components/EnableNotifications.jsx";
import ProposeActivity from "../components/ProposeActivity.jsx";
import PullToRefreshIndicator from "../components/PullToRefreshIndicator.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  endActivity,
  getActivities,
  getRoommates,
  notifyRoommatesToUpdateStatus,
  startActivity,
  updateStatus,
} from "../api/client.js";
import { usePullToRefresh } from "../utils/usePullToRefresh.js";
import { availableCount, AVAILABLE_THRESHOLD } from "../utils/status.js";
import { avatarColor } from "../utils/avatar.js";
import { cx } from "../utils/classNames.js";
import styles from "./StatusPage.module.css";

const ACTIVITY_POLL_INTERVAL_MS = 5000;

// A friendly "Tuesday evening" style subtitle based on the current time.
function whenLabel() {
  const now = new Date();
  const day = now.toLocaleDateString(undefined, { weekday: "long" });
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `${day} ${part} · who’s around?`;
}

export default function StatusPage() {
  const { user, logout } = useAuth();

  const [roommates, setRoommates] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [transitioningId, setTransitioningId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notifyingHousehold, setNotifyingHousehold] = useState(false);
  const [activityFocusRequest, setActivityFocusRequest] = useState(null);

  // Fetch the household; shared by the initial load and pull-to-refresh.
  const loadRoommates = useCallback(async () => {
    try {
      setRoommates(await getRoommates());
      setError("");
    } catch {
      setError("Could not load roommate statuses.");
    }
  }, []);

  const loadActivities = useCallback(async () => {
    try {
      setActivities(await getActivities());
      setLiveError("");
    } catch {
      setLiveError("Could not load household events.");
    }
  }, []);

  // Load both page-level data sets so the live banner and activity cards share
  // one source of truth from the first render onward.
  useEffect(() => {
    Promise.all([loadRoommates(), loadActivities()]).finally(() =>
      setLoading(false),
    );
  }, [loadActivities, loadRoommates]);

  // Keep live-event state current across household devices. Push-enabled open
  // apps refresh immediately from the service worker; visible-page polling and
  // focus refresh cover browsers without notification permission.
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
    window.addEventListener("focus", loadActivities);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    navigator.serviceWorker?.addEventListener(
      "message",
      handleServiceWorkerMessage,
    );

    return () => {
      stopPolling();
      window.removeEventListener("focus", loadActivities);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      navigator.serviceWorker?.removeEventListener(
        "message",
        handleServiceWorkerMessage,
      );
    };
  }, [loadActivities]);

  // Pull down from the top to refresh both household and event state.
  const handleRefresh = useCallback(async () => {
    await Promise.all([loadRoommates(), loadActivities()]);
  }, [loadActivities, loadRoommates]);

  const { pull, refreshing, threshold } = usePullToRefresh(handleRefresh);

  // Split the list into "you" and everyone else, preserving the original index
  // so avatar colors stay stable.
  const { me, meIndex, others } = useMemo(() => {
    const idx = roommates.findIndex((r) => r.id === user.id);
    return {
      me: roommates[idx] ?? null,
      meIndex: idx,
      others: roommates.filter((r) => r.id !== user.id),
    };
  }, [roommates, user.id]);

  const freeCount = availableCount(roommates);
  const showBanner = freeCount >= AVAILABLE_THRESHOLD;
  const liveEvent = activities.find((activity) => activity.isLive) ?? null;

  async function handleLiveTransition(activity, action) {
    if (transitioningId) return;
    setTransitioningId(activity.id);
    setLiveError("");
    try {
      const transition = action === "start" ? startActivity : endActivity;
      setActivities(await transition(activity.id, user.id));
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
      setError("Could not notify the household. Try again.");
    } finally {
      setNotifyingHousehold(false);
    }
  }

  function handleLiveBannerClick() {
    if (!liveEvent) return;
    setActivityFocusRequest((current) => ({
      activityId: liveEvent.id,
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }

  return (
    <>
      {/* Lives off-screen above the top; the pull drags it into view. */}
      <PullToRefreshIndicator
        pull={pull}
        refreshing={refreshing}
        threshold={threshold}
      />

      <div
        className={styles.page}
        style={{
          // Push the whole page down with the pull so the dots are revealed in
          // the gap above the content rather than overlaying it. A transform
          // here would capture the fixed indicator, which is why it sits outside.
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
          <button type="button" onClick={logout} className={styles.signOut}>
            Sign out
          </button>
        </header>

        {error && (
          <p className={cx("ui-errorBox", styles.pageError)}>{error}</p>
        )}

        {loading ? (
          <p className={styles.loading}>Loading the household…</p>
        ) : (
          <>
            {liveError && (
              <p className={cx("ui-errorBox", styles.pageError)}>{liveError}</p>
            )}

            {liveEvent && (
              <LiveEventBanner
                event={liveEvent}
                canEnd={liveEvent.proposedById === user.id}
                ending={transitioningId === liveEvent.id}
                onEnd={() => handleLiveTransition(liveEvent, "end")}
                user={user}
                onBannerClick={handleLiveBannerClick}
              />
            )}

            <EnableNotifications />

            {showBanner && <NotificationBanner count={freeCount} />}

            {me && (
              <div className={styles.ownCard}>
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
                The household
              </p>
              <button
                type="button"
                onClick={handleNotifyHousehold}
                disabled={notifyingHousehold}
                aria-label="Notify all to update"
                title="Notify all to update"
                className={cx("ui-iconPrimary", styles.notifyButton)}
              >
                <img
                  src="/megaphone.png"
                  alt=""
                  className={styles.notifyIcon}
                />
              </button>
            </div>
            <div className={styles.householdGrid}>
              {others.map((roommate) => (
                <StatusCard key={roommate.id} roommate={roommate} />
              ))}
            </div>

            <ProposeActivity
              activities={activities}
              onActivitiesChange={setActivities}
              liveEvent={liveEvent}
              transitioningId={transitioningId}
              onLiveTransition={handleLiveTransition}
              roommates={roommates}
              activityFocusRequest={activityFocusRequest}
            />
          </>
        )}
      </div>
    </>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Brandmark from "../components/Brandmark.jsx";
import YouCard from "../components/YouCard.jsx";
import StatusCard from "../components/StatusCard.jsx";
import NotificationBanner from "../components/NotificationBanner.jsx";
import LiveEventBanner from "../components/LiveEventBanner.jsx";
import EnableNotifications from "../components/EnableNotifications.jsx";
import FeatureTabs from "../components/FeatureTabs.jsx";
import JamWidget, { JamShareForm } from "../components/JamWidget.jsx";
import ModalShell from "../components/ModalShell.jsx";
import ProposeActivity from "../components/ProposeActivity.jsx";
import PullToRefreshIndicator from "../components/PullToRefreshIndicator.jsx";
import RequestFeature from "../components/RequestFeature.jsx";
import ActivityCreateForm from "../components/ActivityCreateForm.jsx";
import RequestCreateForm from "../components/RequestCreateForm.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  endActivity,
  getActivities,
  getJam,
  getRequests,
  getRoommates,
  notifyRoommatesToUpdateStatus,
  pokeRoommate,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const ownCardRef = useRef(null);

  const [roommates, setRoommates] = useState([]);
  const [activities, setActivities] = useState([]);
  const [jam, setJam] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [transitioningId, setTransitioningId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notifyingHousehold, setNotifyingHousehold] = useState(false);
  const [activityFocusRequest, setActivityFocusRequest] = useState(null);
  const [requestFocusRequest, setRequestFocusRequest] = useState(null);
  const [activeBoardTab, setActiveBoardTab] = useState("activities");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [jamModalOpen, setJamModalOpen] = useState(false);

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

  const loadRequests = useCallback(async () => {
    try {
      setRequests(await getRequests());
      setLiveError("");
    } catch {
      setLiveError("Could not load household requests.");
    }
  }, []);

  const loadJam = useCallback(async () => {
    try {
      setJam(await getJam());
      setLiveError("");
    } catch {
      setLiveError("Could not load the Spotify Jam.");
    }
  }, []);

  // Load page-level data sets so household, activities, and requests share one
  // source of truth from the first render onward.
  useEffect(() => {
    Promise.all([
      loadRoommates(),
      loadActivities(),
      loadRequests(),
      loadJam(),
    ]).finally(() => setLoading(false));
  }, [loadActivities, loadJam, loadRequests, loadRoommates]);

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
      if (event.data?.type === "requests-changed") loadRequests();
      if (event.data?.type === "jam-changed") loadJam();
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
  }, [loadActivities, loadJam, loadRequests]);

  // Pull down from the top to refresh household, activity, and request state.
  const handleRefresh = useCallback(async () => {
    await Promise.all([
      loadRoommates(),
      loadActivities(),
      loadRequests(),
      loadJam(),
    ]);
  }, [loadActivities, loadJam, loadRequests, loadRoommates]);

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
  const liveEvents = activities.filter((activity) => activity.isLive);

  // Poke notifications carry this one-shot intent. Open the editor after the
  // household loads, then remove the query so refreshes do not reopen it.
  useEffect(() => {
    if (!me || searchParams.get("updateStatus") !== "1") return;
    setEditing(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("updateStatus");
    setSearchParams(nextParams, { replace: true });
    window.requestAnimationFrame(() => {
      ownCardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [me, searchParams, setSearchParams]);

  useEffect(() => {
    const requestId = searchParams.get("request");
    if (!requestId) return;
    setActiveBoardTab("requests");
    setRequestFocusRequest((current) => ({
      requestId,
      requestKey: (current?.requestKey ?? 0) + 1,
    }));
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("request");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

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

  async function handlePokeRoommate(roommateId) {
    await pokeRoommate(roommateId, user.id);
  }

  function handleLiveBannerClick(activityId) {
    setActiveBoardTab("activities");
    setActivityFocusRequest((current) => ({
      activityId,
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }

  const createButtonLabel =
    activeBoardTab === "requests" ? "New request" : "New activity";

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
                    onBannerClick={() => handleLiveBannerClick(liveEvent.id)}
                  />
                ))}
              </div>
            )}

            {jam && (
              <JamWidget
                jam={jam}
                onJamChange={setJam}
                onReplace={() => setJamModalOpen(true)}
              />
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
              <button
                type="button"
                onClick={() => setJamModalOpen(true)}
                aria-label={jam ? "Replace Spotify Jam" : "Share Spotify Jam"}
                title={jam ? "Replace Spotify Jam" : "Share Spotify Jam"}
                className={cx(styles.jamButton)}
              >
                <img src="/spotify.png" alt="" className={styles.spotifyIcon} />
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

            <FeatureTabs
              defaultTabId="activities"
              activeTabId={activeBoardTab}
              onActiveTabChange={setActiveBoardTab}
              actions={
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(true)}
                  className={cx("ui-primaryButton", styles.createButton)}
                >
                  {createButtonLabel}
                </button>
              }
              tabs={[
                {
                  id: "activities",
                  label: "Activities",
                  content: (
                    <ProposeActivity
                      activities={activities}
                      onActivitiesChange={setActivities}
                      transitioningId={transitioningId}
                      onLiveTransition={handleLiveTransition}
                      roommates={roommates}
                      activityFocusRequest={activityFocusRequest}
                    />
                  ),
                },
                {
                  id: "requests",
                  label: "Requests",
                  content: (
                    <RequestFeature
                      requests={requests}
                      onRequestsChange={setRequests}
                      roommates={roommates}
                      requestFocusRequest={requestFocusRequest}
                    />
                  ),
                },
              ]}
            />
            {createModalOpen && (
              <ModalShell
                title={
                  activeBoardTab === "requests"
                    ? "Create a request"
                    : "Create an activity"
                }
                onClose={() => setCreateModalOpen(false)}
                widthClassName={styles.createModal}
              >
                {activeBoardTab === "requests" ? (
                  <RequestCreateForm
                    roommates={roommates}
                    onRequestsChange={setRequests}
                    onSuccess={() => setCreateModalOpen(false)}
                    onCancel={() => setCreateModalOpen(false)}
                  />
                ) : (
                  <ActivityCreateForm
                    onActivitiesChange={setActivities}
                    onSuccess={() => setCreateModalOpen(false)}
                    onCancel={() => setCreateModalOpen(false)}
                  />
                )}
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
                  onJamChange={setJam}
                  onSuccess={() => setJamModalOpen(false)}
                />
              </ModalShell>
            )}
          </>
        )}
      </div>
    </>
  );
}

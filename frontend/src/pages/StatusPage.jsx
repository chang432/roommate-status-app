import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Brandmark from "../components/Brandmark.jsx";
import EnableNotifications from "../components/EnableNotifications.jsx";
import GroupFeed from "../components/GroupFeed.jsx";
import GroupSwitcherDrawer from "../components/GroupSwitcherDrawer.jsx";
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
  getGroups,
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
  const { user, logout, deleteAccount, joinGroup, createGroup, selectGroup } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const ownCardRef = useRef(null);
  const feedRef = useRef(null);

  const [roommates, setRoommates] = useState([]);
  const [activities, setActivities] = useState([]);
  const [statusLoadedGroupId, setStatusLoadedGroupId] = useState(null);
  const [feedLoadedGroupId, setFeedLoadedGroupId] = useState(null);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [transitioningId, setTransitioningId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notifyingHousehold, setNotifyingHousehold] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState("");
  const activeGroupIdRef = useRef(user.activeGroupId);

  // Ignore a response for a group the user has already left. This keeps an
  // older, slower request from replacing the newly selected household's data.
  activeGroupIdRef.current = user.activeGroupId;

  const loadGroups = useCallback(async () => {
    try {
      const { groups: memberships } = await getGroups(user.id);
      setGroups(memberships);
      setGroupsError("");

      const requestedGroupId = searchParams.get("groupId");
      const isMember = (groupId) => memberships.some((group) => group.groupId === groupId);
      const nextGroupId = isMember(requestedGroupId)
        ? requestedGroupId
        : isMember(user.activeGroupId)
          ? user.activeGroupId
          : memberships[0]?.groupId;
      if (nextGroupId && nextGroupId !== user.activeGroupId) selectGroup(nextGroupId);
      if (requestedGroupId) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete("groupId");
        setSearchParams(nextParams, { replace: true });
      }
    } catch (err) {
      setGroupsError(err.message || "Could not load your groups.");
    } finally {
      setGroupsLoading(false);
    }
  }, [searchParams, selectGroup, setSearchParams, user.activeGroupId, user.id]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const loadRoommates = useCallback(async () => {
    const groupId = user.activeGroupId;
    try {
      const nextRoommates = await getRoommates(user.id, groupId);
      if (activeGroupIdRef.current === groupId) {
        setRoommates(nextRoommates);
        setError("");
      }
    } catch {
      if (activeGroupIdRef.current === groupId) {
        setError("Could not load roommate statuses.");
      }
    }
  }, [user.activeGroupId, user.id]);

  const loadActivities = useCallback(async () => {
    const groupId = user.activeGroupId;
    try {
      const nextActivities = await getActivities(user.id, groupId);
      if (activeGroupIdRef.current === groupId) {
        setActivities(nextActivities);
        setLiveError("");
      }
    } catch {
      if (activeGroupIdRef.current === groupId) {
        setLiveError("Could not load household events.");
      }
    }
  }, [user.activeGroupId, user.id]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadRoommates(), loadActivities()]);
  }, [loadActivities, loadRoommates]);

  useEffect(() => {
    let isCurrent = true;
    loadAll().finally(() => {
      if (isCurrent) setStatusLoadedGroupId(user.activeGroupId);
    });
    return () => {
      isCurrent = false;
    };
  }, [loadAll, user.activeGroupId]);

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
  const selectedGroup = groups.find((group) => group.groupId === user.activeGroupId) ?? groups[0];
  const groupDataLoading =
    groupsLoading ||
    statusLoadedGroupId !== user.activeGroupId ||
    feedLoadedGroupId !== user.activeGroupId;

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

  function scrollToFeed() {
    feedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const handleGroupFeedLoadStateChange = useCallback((groupId, isLoading) => {
    if (isLoading) {
      setFeedLoadedGroupId((loadedGroupId) =>
        loadedGroupId === groupId ? null : loadedGroupId,
      );
      return;
    }
    setFeedLoadedGroupId(groupId);
  }, []);

  const handleGroupSelect = useCallback((groupId) => {
    setGroupDrawerOpen(false);
    if (groupId === user.activeGroupId) return;
    setStatusLoadedGroupId(null);
    setFeedLoadedGroupId(null);
    selectGroup(groupId);
  }, [selectGroup, user.activeGroupId]);

  async function handleJoinGroup(code) {
    const joined = await joinGroup(code);
    const { groups: memberships } = await getGroups(joined.id);
    setGroups(memberships);
    setGroupsError("");
  }

  async function handleCreateGroup(name) {
    const created = await createGroup(name);
    const { groups: memberships } = await getGroups(created.id);
    setGroups(memberships);
    setGroupsError("");
  }

  return (
    <>
      <PullToRefreshIndicator
        pull={pull}
        refreshing={refreshing}
        threshold={threshold}
      />

      <GroupSwitcherDrawer
        groups={groups}
        activeGroupId={user.activeGroupId}
        open={groupDrawerOpen}
        loading={groupsLoading}
        error={groupsError}
        onClose={() => setGroupDrawerOpen(false)}
        onSelect={handleGroupSelect}
        onJoin={handleJoinGroup}
        onCreate={handleCreateGroup}
      />

      <div
        className={styles.page}
        style={{
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: pull > 0 && !refreshing ? "none" : "transform 260ms ease",
        }}
      >
        <header className={styles.header}>
          <button
            type="button"
            onClick={() => setGroupDrawerOpen(true)}
            className={styles.brandmarkButton}
            aria-label={`Open group switcher. Current group: ${selectedGroup?.name || "unknown"}`}
            aria-haspopup="dialog"
            aria-expanded={groupDrawerOpen}
          >
            <Brandmark
              className={styles.brandmark}
              iconClassName={styles.brandmarkIcon}
              inverted
            />
          </button>
          <div className={styles.headerText}>
            <p className={styles.currentGroupLabel}>Current group</p>
            <h1 className={styles.title}>{selectedGroup?.name || "Your group"}</h1>
            <p className={styles.subtitle}>{whenLabel()}</p>
          </div>
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

        {error && (
          <p className={cx("ui-errorBox", styles.pageError)}>{error}</p>
        )}

        {groupDataLoading && (
          <div className={styles.groupLoading} role="status" aria-live="polite">
            <span className={styles.loadingSpinner} aria-hidden="true" />
            <p>Loading {selectedGroup?.name || "your group"}…</p>
          </div>
        )}

        <main hidden={groupDataLoading}>
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
                    onBannerClick={scrollToFeed}
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
                {selectedGroup?.name || "Your group"}
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

        <div ref={feedRef} hidden={groupDataLoading}>
          <GroupFeed
            roommates={displayedRoommates}
            onLoadStateChange={handleGroupFeedLoadStateChange}
          />
        </div>

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

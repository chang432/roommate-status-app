import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Brandmark from "../components/ui/Brandmark.jsx";
import BookClub from "../components/book-club/BookClub.jsx";
import EnableNotifications from "../components/profile/EnableNotifications.jsx";
import GroupFeed from "../components/feed/GroupFeed.jsx";
import JamWidget, { JamShareForm } from "../components/jam/JamWidget.jsx";
import GroupSwitcherDrawer from "../components/groups/GroupSwitcherDrawer.jsx";
import HouseholdRoster from "../components/household/HouseholdRoster.jsx";
import LiveEventBanner from "../components/feed/LiveEventBanner.jsx";
import ModalShell from "../components/ui/ModalShell.jsx";
import NotificationBanner from "../components/ui/NotificationBanner.jsx";
import ProfileSettings from "../components/profile/ProfileSettings.jsx";
import PullToRefreshIndicator from "../components/ui/PullToRefreshIndicator.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  endActivity,
  endWatchparty,
  getActivities,
  getGroups,
  getJam,
  getRoommates,
  getShows,
  startActivity,
} from "../api/client.js";
import { cx } from "../utils/classNames.js";
import { usePullToRefresh } from "../utils/usePullToRefresh.js";
import {
  AVAILABLE_THRESHOLD,
  availableCount,
  decorateRoommatesWithActivityStatus,
} from "../utils/status.js";
import styles from "./StatusPage.module.css";

const ACTIVITY_POLL_INTERVAL_MS = 5000;

export default function StatusPage() {
  const { user, logout, deleteAccount, joinGroup, createGroup, selectGroup } =
    useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const feedRef = useRef(null);

  const [roommates, setRoommates] = useState([]);
  const [activities, setActivities] = useState([]);
  const [shows, setShows] = useState([]);
  const [jam, setJam] = useState(null);
  const [statusLoadedGroupId, setStatusLoadedGroupId] = useState(null);
  const [feedLoadedGroupId, setFeedLoadedGroupId] = useState(null);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [transitioningId, setTransitioningId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [jamModalOpen, setJamModalOpen] = useState(false);
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
      const isMember = (groupId) =>
        memberships.some((group) => group.groupId === groupId);
      const nextGroupId = isMember(requestedGroupId)
        ? requestedGroupId
        : isMember(user.activeGroupId)
          ? user.activeGroupId
          : memberships[0]?.groupId;
      if (nextGroupId && nextGroupId !== user.activeGroupId)
        selectGroup(nextGroupId);
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

  const loadJam = useCallback(async () => {
    const groupId = user.activeGroupId;
    try {
      const nextJam = await getJam(user.id);
      if (activeGroupIdRef.current === groupId) setJam(nextJam);
    } catch {
      if (activeGroupIdRef.current === groupId) setJam(null);
    }
  }, [user.activeGroupId, user.id]);

  const loadShows = useCallback(async () => {
    const groupId = user.activeGroupId;
    try {
      const nextShows = await getShows(user.id);
      if (activeGroupIdRef.current === groupId) setShows(nextShows);
    } catch {
      if (activeGroupIdRef.current === groupId) setShows([]);
    }
  }, [user.activeGroupId, user.id]);

  const loadAll = useCallback(async () => {
    await Promise.all([
      loadRoommates(),
      loadActivities(),
      loadJam(),
      loadShows(),
    ]);
  }, [loadActivities, loadJam, loadRoommates, loadShows]);

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
      if (event.data?.type === "jam-changed") loadJam();
      if (event.data?.type === "shows-changed") loadShows();
    }

    startPolling();
    window.addEventListener("roomie:shows-changed", loadShows);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    navigator.serviceWorker?.addEventListener(
      "message",
      handleServiceWorkerMessage,
    );

    return () => {
      stopPolling();
      window.removeEventListener("roomie:shows-changed", loadShows);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      navigator.serviceWorker?.removeEventListener(
        "message",
        handleServiceWorkerMessage,
      );
    };
  }, [loadActivities, loadJam, loadShows]);

  const { pull, refreshing, threshold } = usePullToRefresh(loadAll);

  const displayedRoommates = useMemo(
    () => decorateRoommatesWithActivityStatus(roommates, activities),
    [activities, roommates],
  );

  const freeCount = availableCount(displayedRoommates);
  const showBanner = freeCount >= AVAILABLE_THRESHOLD;
  const liveEvents = activities.filter((activity) => activity.isLive);
  const liveWatchparties = shows.filter((show) => show.isWatchpartyLive);
  const selectedGroup =
    groups.find((group) => group.groupId === user.activeGroupId) ?? groups[0];
  // Group controls are shared with everyone in the household. Missing fields
  // mean an older group record, which remains fully visible by default.
  const showRoster = selectedGroup?.showRoster !== false;
  const showFeed = selectedGroup?.showFeed !== false;
  const showBookClub = selectedGroup?.showBookClub !== false;
  const groupDataLoading =
    groupsLoading ||
    statusLoadedGroupId !== user.activeGroupId ||
    (showFeed && feedLoadedGroupId !== user.activeGroupId);

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

  async function handleWatchpartyEnd(show) {
    if (transitioningId) return;
    setTransitioningId(show.id);
    setLiveError("");
    try {
      setShows(await endWatchparty(show.id, user.id));
      window.dispatchEvent(new Event("roomie:shows-changed"));
    } catch (err) {
      setLiveError(err.message || "Could not end the watchparty. Try again.");
    } finally {
      setTransitioningId(null);
    }
  }

  const openJamModal = useCallback(() => setJamModalOpen(true), []);

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

  const handleGroupSelect = useCallback(
    (groupId) => {
      setGroupDrawerOpen(false);
      if (groupId === user.activeGroupId) return;
      setStatusLoadedGroupId(null);
      setFeedLoadedGroupId(null);
      selectGroup(groupId);
    },
    [selectGroup, user.activeGroupId],
  );

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
            <h1 className={styles.title}>
              {selectedGroup?.name || "Your group"}
            </h1>
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

          {(liveEvents.length > 0 || liveWatchparties.length > 0) && (
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
                  type="event"
                />
              ))}
              {liveWatchparties.map((show) => (
                <LiveEventBanner
                  key={`watchparty:${show.id}`}
                  event={{
                    id: show.id,
                    text: `Watching ${show.title}${
                      show.watchpartySeason && show.watchpartyEpisode
                        ? ` S${show.watchpartySeason} E${show.watchpartyEpisode}`
                        : ""
                    }`,
                    proposedBy: show.watchpartyStartedBy || "Someone",
                    liveStartedAt: show.watchpartyStartedAt,
                    memberIds: (show.members || []).map((member) => member.id),
                  }}
                  canEnd={(show.members || []).some(
                    (member) => member.id === user.id,
                  )}
                  ending={transitioningId === show.id}
                  onEnd={() => handleWatchpartyEnd(show)}
                  user={user}
                  onBannerClick={scrollToFeed}
                  type="watchparty"
                />
              ))}
            </div>
          )}

          <EnableNotifications />
          {showBanner && <NotificationBanner count={freeCount} />}

          {showRoster && (
            <HouseholdRoster
              roommates={displayedRoommates}
              groupName={selectedGroup?.name}
              hasJam={Boolean(jam)}
              onShareJam={openJamModal}
              onRoommatesChange={setRoommates}
              onError={setError}
            />
          )}
        </main>

        {jam && (
          <div hidden={groupDataLoading}>
            <JamWidget jam={jam} onJamChange={setJam} onReplace={openJamModal} />
          </div>
        )}

        {showBookClub && !groupDataLoading && (
          <BookClub roommates={displayedRoommates} groupId={user.activeGroupId} />
        )}

        {showFeed && (
          <div ref={feedRef} hidden={groupDataLoading}>
            <GroupFeed
              roommates={displayedRoommates}
              onLoadStateChange={handleGroupFeedLoadStateChange}
            />
          </div>
        )}

        {settingsOpen && (
          <ModalShell
            title="Profile settings"
            onClose={() => setSettingsOpen(false)}
            widthClassName={styles.settingsModal}
          >
            <ProfileSettings
              user={user}
              roommates={roommates}
              onRoommatesChange={setRoommates}
              onGroupChange={(updatedGroup) =>
                setGroups((currentGroups) =>
                  currentGroups.map((group) =>
                    group.groupId === updatedGroup.groupId ? updatedGroup : group,
                  ),
                )
              }
              onSignOut={logout}
              onDeleteAccount={deleteAccount}
            />
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
      </div>
    </>
  );
}

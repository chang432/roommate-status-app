import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Brandmark from "../components/ui/Brandmark.jsx";
import BookClub from "../components/book-club/BookClub.jsx";
import EnableNotifications from "../components/profile/EnableNotifications.jsx";
import { GroupFeedView } from "../components/feed/GroupFeed.jsx";
import JamWidget, { JamShareForm } from "../components/jam/JamWidget.jsx";
import GroupSwitcherDrawer from "../components/groups/GroupSwitcherDrawer.jsx";
import HouseholdRoster from "../components/household/HouseholdRoster.jsx";
import LiveEventBanner from "../components/feed/LiveEventBanner.jsx";
import ModalShell from "../components/ui/ModalShell.jsx";
import NotificationBanner from "../components/ui/NotificationBanner.jsx";
import ProfileSettings from "../components/profile/ProfileSettings.jsx";
import PullToRefreshIndicator from "../components/ui/PullToRefreshIndicator.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { endActivity, startActivity } from "../api/activities.js";
import { getGroups } from "../api/groups.js";
import { getRoommates } from "../api/roommates.js";
import { endWatchparty } from "../api/shows.js";
import useGroupModules from "../hooks/useGroupModules.js";
import { cx } from "../utils/classNames.js";
import { usePullToRefresh } from "../utils/usePullToRefresh.js";
import {
  AVAILABLE_THRESHOLD,
  availableCount,
  decorateRoommatesWithActivityStatus,
} from "../utils/status.js";
import styles from "./StatusPage.module.css";

export default function StatusPage() {
  const { user, logout, deleteAccount, joinGroup, createGroup, selectGroup } =
    useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const feedRef = useRef(null);

  const [roommates, setRoommates] = useState([]);
  const [statusLoadedGroupId, setStatusLoadedGroupId] = useState(null);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [transitioningId, setTransitioningId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [jamModalOpen, setJamModalOpen] = useState(false);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState("");
  const [bookClubRefreshToken, setBookClubRefreshToken] = useState(0);
  const activeGroupIdRef = useRef(user.activeGroupId);
  const {
    modules,
    loading: modulesLoading,
    error: modulesError,
    refreshModules,
  } = useGroupModules(user.id, user.activeGroupId);

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
          : isMember(user.groupId)
            ? user.groupId
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
  }, [searchParams, selectGroup, setSearchParams, user.activeGroupId, user.groupId, user.id]);

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

  const refreshAll = useCallback(async () => {
    await Promise.all([loadRoommates(), refreshModules()]);
    // Book Club owns its fetch so it can advance an overdue meeting. Bump this
    // token after each page refresh to include it in pull-to-refresh as well.
    setBookClubRefreshToken((token) => token + 1);
  }, [loadRoommates, refreshModules]);

  useEffect(() => {
    let isCurrent = true;
    loadRoommates().finally(() => {
      if (isCurrent) setStatusLoadedGroupId(user.activeGroupId);
    });
    return () => {
      isCurrent = false;
    };
  }, [loadRoommates, user.activeGroupId]);

  const { pull, refreshing, threshold } = usePullToRefresh(refreshAll);

  const activities = useMemo(
    () =>
      modules
        .filter((module) => module.type === "events")
        .map((module) => module.payload),
    [modules],
  );
  const shows = useMemo(
    () =>
      modules
        .filter((module) => module.type === "tv")
        .map((module) => module.payload),
    [modules],
  );
  const jam =
    modules.find((module) => module.type === "spotify")?.payload ?? null;

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
    modulesLoading;

  async function handleLiveTransition(activity, action) {
    if (transitioningId) return;
    setTransitioningId(activity.id);
    setLiveError("");
    try {
      const transition = action === "start" ? startActivity : endActivity;
      await transition(activity.id, user.id);
      await refreshModules();
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
      await endWatchparty(show.id, user.id);
      await refreshModules();
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

  const handleGroupSelect = useCallback(
    (groupId) => {
      setGroupDrawerOpen(false);
      if (groupId === user.activeGroupId) return;
      setStatusLoadedGroupId(null);
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
            <JamWidget
              jam={jam}
              onJamChange={refreshModules}
              onReplace={openJamModal}
            />
          </div>
        )}

        {showBookClub && !groupDataLoading && (
          <BookClub
            roommates={displayedRoommates}
            groupId={user.activeGroupId}
            refreshToken={bookClubRefreshToken}
          />
        )}

        {(showFeed || showBookClub) && (
          <div ref={feedRef} hidden={groupDataLoading}>
            <GroupFeedView
              roommates={displayedRoommates}
              modules={modules}
              loading={modulesLoading}
              error={modulesError}
              refreshModules={refreshModules}
              showStandardModules={showFeed}
              showBookClub={showBookClub}
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
              onJamChange={refreshModules}
              onSuccess={() => setJamModalOpen(false)}
            />
          </ModalShell>
        )}
      </div>
    </>
  );
}

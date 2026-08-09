import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Brandmark from "../components/ui/Brandmark.jsx";
import BookClub from "../components/book-club/BookClub.jsx";
import { GroupFeedView } from "../components/feed/GroupFeed.jsx";
import JamWidget, { JamShareForm } from "../components/jam/JamWidget.jsx";
import GroupSwitcherDrawer from "../components/groups/GroupSwitcherDrawer.jsx";
import GroupSettings from "../components/groups/GroupSettings.jsx";
import HouseholdRoster from "../components/household/HouseholdRoster.jsx";
import LiveModuleBanners from "../components/feed/LiveModuleBanners.jsx";
import ModalShell from "../components/ui/ModalShell.jsx";
import NotificationBanner from "../components/ui/NotificationBanner.jsx";
import ProfileSettings from "../components/profile/ProfileSettings.jsx";
import PullToRefreshIndicator from "../components/ui/PullToRefreshIndicator.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { endActivity, startActivity } from "../api/activities.js";
import { endWatchparty } from "../api/shows.js";
import useGroupModules from "../hooks/useGroupModules.js";
import useGroupMemberships from "../hooks/useGroupMemberships.js";
import useRoommateStatuses from "../hooks/useRoommateStatuses.js";
import { cx } from "../utils/classNames.js";
import { usePullToRefresh } from "../utils/usePullToRefresh.js";
import {
  AVAILABLE_THRESHOLD,
  availableCount,
  decorateRoommatesWithActivityStatus,
} from "../utils/status.js";
import styles from "./StatusPage.module.css";

export default function StatusPage() {
  const { user, joinGroup, createGroup, selectGroup } =
    useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const feedRef = useRef(null);

  const [liveError, setLiveError] = useState("");
  const [transitioningId, setTransitioningId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [jamModalOpen, setJamModalOpen] = useState(false);
  const [bookClubRefreshToken, setBookClubRefreshToken] = useState(0);
  const { setTheme } = useTheme();
  const {
    create: handleCreateGroup,
    error: groupsError,
    groups,
    join: handleJoinGroup,
    loading: groupsLoading,
    update: handleGroupChange,
  } = useGroupMemberships({
    createGroup,
    joinGroup,
    searchParams,
    selectGroup,
    setSearchParams,
    user,
  });
  const {
    error,
    loading: roommatesLoading,
    refreshRoommates: loadRoommates,
    roommates,
    setError,
    setRoommates,
  } = useRoommateStatuses(user.id, user.activeGroupId);
  const {
    modules,
    loading: modulesLoading,
    error: modulesError,
    refreshModules,
  } = useGroupModules(user.id, user.activeGroupId);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadRoommates(), refreshModules()]);
    // Book Club owns its fetch so it can advance an overdue meeting. Bump this
    // token after each page refresh to include it in pull-to-refresh as well.
    setBookClubRefreshToken((token) => token + 1);
  }, [loadRoommates, refreshModules]);

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
  const enabledModules = selectedGroup?.enabledModules ?? [];
  const enabledModuleSet = new Set(enabledModules);
  const showRoster = enabledModuleSet.has("roster");
  const showBookClub = enabledModuleSet.has("book-club");
  const showSpotify = enabledModuleSet.has("spotify");
  const hasFeedModules = enabledModules.some((moduleId) =>
    ["events", "requests", "checklists", "polls", "counters", "tv", "book-club", "forums"].includes(moduleId),
  );
  const groupDataLoading =
    groupsLoading ||
    roommatesLoading ||
    modulesLoading;

  useEffect(() => {
    setTheme(selectedGroup?.theme ?? "system");
  }, [selectedGroup?.groupId, selectedGroup?.theme, setTheme]);

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
      selectGroup(groupId);
    },
    [selectGroup, user.activeGroupId],
  );

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
        onEdit={() => {
          setGroupDrawerOpen(false);
          setGroupSettingsOpen(true);
        }}
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
              <LiveModuleBanners
                liveEvents={liveEvents}
                liveWatchparties={liveWatchparties}
                onEndEvent={(event) => handleLiveTransition(event, "end")}
                onEndWatchparty={handleWatchpartyEnd}
                onOpenFeed={scrollToFeed}
                transitioningId={transitioningId}
                user={user}
              />
            </div>
          )}

          {showBanner && <NotificationBanner count={freeCount} />}

          {showRoster && (
            <HouseholdRoster
              roommates={displayedRoommates}
              groupName={selectedGroup?.name}
              onRoommatesChange={setRoommates}
              onError={setError}
            />
          )}
        </main>

        {showSpotify && (
          <div hidden={groupDataLoading}>
            {jam ? (
              <JamWidget jam={jam} onJamChange={refreshModules} onReplace={openJamModal} />
            ) : (
              <section className={styles.jamEmpty}>
                <div><p>Spotify Jam</p><span>No Jam is active in this group.</span></div>
                <button type="button" onClick={openJamModal} className="ui-primaryButton">Share Jam</button>
              </section>
            )}
          </div>
        )}

        {showBookClub && !groupDataLoading && (
          <BookClub
            roommates={displayedRoommates}
            groupId={user.activeGroupId}
            refreshToken={bookClubRefreshToken}
          />
        )}

        {hasFeedModules && (
          <div ref={feedRef} hidden={groupDataLoading}>
            <GroupFeedView
              roommates={displayedRoommates}
              modules={modules}
              loading={modulesLoading}
              error={modulesError}
              refreshModules={refreshModules}
              enabledModuleIds={enabledModules}
            />
          </div>
        )}

        {settingsOpen && (
          <ProfileSettings
            onClose={() => setSettingsOpen(false)}
            widthClassName={styles.settingsModal}
            onProfileChanged={loadRoommates}
          />
        )}
        {groupSettingsOpen && selectedGroup ? (
          <GroupSettings
            group={selectedGroup}
            roommates={roommates}
            onClose={() => setGroupSettingsOpen(false)}
            onGroupChange={handleGroupChange}
            onRoommatesChange={setRoommates}
          />
        ) : null}
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

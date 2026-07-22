import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import StatusCard from "./StatusCard.jsx";
import YouCard from "./YouCard.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import {
  notifyRoommatesToUpdateStatus,
  pokeRoommate,
  updateStatus,
} from "../../api/roommates.js";
import { avatarColor } from "../../utils/avatar.js";
import { cx } from "../../utils/classNames.js";
import styles from "./HouseholdRoster.module.css";

// The household roster: your own status card, the group action header, and a
// grid of everyone else. Roster state is *controlled* — `roommates` is owned by
// the page because GroupFeed reads it for mentions and ProfileSettings mutates
// it when an admin removes a member, so any roster change is handed back up
// through onRoommatesChange rather than refetched here.
export default function HouseholdRoster({
  roommates,
  groupName,
  hasJam,
  onShareJam,
  onRoommatesChange,
  onError,
}) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const ownCardRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notifyingHousehold, setNotifyingHousehold] = useState(false);

  // meIndex is the position in the *full* roster: avatar colors are assigned by
  // index, so deriving it from a pre-split list would recolor everyone.
  const { me, meIndex, others } = useMemo(() => {
    const idx = roommates.findIndex((r) => r.id === user.id);
    return {
      me: roommates[idx] ?? null,
      meIndex: idx,
      others: roommates.filter((r) => r.id !== user.id),
    };
  }, [roommates, user.id]);

  // Poke notifications deep-link back here with ?updateStatus=1; open the
  // editor, consume the param, and bring the card into view.
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

  async function handleSave(status, statusText) {
    setSaving(true);
    onError("");
    try {
      // The save returns the whole household, so the page re-renders from the
      // server's view rather than a locally patched roster.
      onRoommatesChange(await updateStatus(user.id, status, statusText));
      setEditing(false);
    } catch {
      onError("Could not save your status. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleNotifyHousehold() {
    if (notifyingHousehold) return;
    setNotifyingHousehold(true);
    onError("");
    try {
      await notifyRoommatesToUpdateStatus(user.id);
    } catch {
      onError("Could not notify the shire. Try again.");
    } finally {
      setNotifyingHousehold(false);
    }
  }

  // No try/catch: StatusModal catches and renders the failure itself, and
  // swallowing it here would leave the poke button silently dead.
  async function handlePokeRoommate(roommateId) {
    await pokeRoommate(roommateId, user.id);
  }

  return (
    <>
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

      <div className={styles.header}>
        {/* `||` not `??`: a blank group name should fall back too. */}
        <p className={cx("ui-sectionLabel", styles.title)}>
          {groupName || "Your group"}
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
        <button
          type="button"
          onClick={onShareJam}
          aria-label={hasJam ? "Replace Spotify Jam" : "Share Spotify Jam"}
          title={hasJam ? "Replace Spotify Jam" : "Share Spotify Jam"}
          className={cx("ui-iconPrimary", styles.jamButton)}
        >
          <img src="/spotify.png" alt="" className={styles.spotifyIcon} />
        </button>
      </div>
      <div className={styles.memberGrid}>
        {others.map((roommate) => (
          <StatusCard
            key={roommate.id}
            roommate={roommate}
            onPoke={handlePokeRoommate}
          />
        ))}
      </div>
    </>
  );
}

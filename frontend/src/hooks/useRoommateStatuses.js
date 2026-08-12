import { useCallback, useEffect, useRef, useState } from "react";
import { getRoommates } from "../api/roommates.js";

export default function useRoommateStatuses(userId, groupId) {
  const [roommates, setRoommates] = useState([]);
  const [loadedGroupId, setLoadedGroupId] = useState(null);
  const [error, setError] = useState("");
  const activeGroupIdRef = useRef(groupId);
  activeGroupIdRef.current = groupId;

  const refreshRoommates = useCallback(async () => {
    const requestedGroupId = groupId;
    try {
      const next = await getRoommates(userId, requestedGroupId);
      if (activeGroupIdRef.current !== requestedGroupId) return false;
      setRoommates(next);
      setError("");
      return true;
    } catch {
      if (activeGroupIdRef.current !== requestedGroupId) return false;
      setError("Could not load roommate statuses.");
      return false;
    }
  }, [groupId, userId]);

  useEffect(() => {
    let current = true;
    setLoadedGroupId(null);
    refreshRoommates().finally(() => {
      if (current && activeGroupIdRef.current === groupId) {
        setLoadedGroupId(groupId);
      }
    });
    return () => {
      current = false;
    };
  }, [groupId, refreshRoommates]);

  return {
    error,
    loading: loadedGroupId !== groupId,
    refreshRoommates,
    roommates,
    setError,
    setRoommates,
  };
}


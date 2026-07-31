import { useCallback, useEffect, useRef, useState } from "react";
import { getFeed } from "../api/feed.js";
import { createModules } from "../models/modules.js";

const FEED_POLL_INTERVAL_MS = 5000;

export default function useGroupModules(userId, groupId) {
  const [modules, setModules] = useState([]);
  const [loadedGroupId, setLoadedGroupId] = useState(null);
  const [error, setError] = useState("");
  const activeGroupIdRef = useRef(groupId);
  activeGroupIdRef.current = groupId;

  const refreshModules = useCallback(async () => {
    const requestedGroupId = groupId;
    try {
      const nextModules = createModules(
        await getFeed(userId, "all", requestedGroupId),
      );
      if (activeGroupIdRef.current !== requestedGroupId) return false;
      setModules(nextModules);
      setError("");
      return true;
    } catch {
      if (activeGroupIdRef.current !== requestedGroupId) return false;
      setError("Could not load the group feed.");
      return false;
    } finally {
      if (activeGroupIdRef.current === requestedGroupId) {
        setLoadedGroupId(requestedGroupId);
      }
    }
  }, [groupId, userId]);

  useEffect(() => {
    setLoadedGroupId(null);
    setModules([]);
    refreshModules();
  }, [refreshModules]);

  useEffect(() => {
    let pollId = null;

    function startPolling() {
      if (pollId !== null || document.visibilityState !== "visible") return;
      pollId = window.setInterval(refreshModules, FEED_POLL_INTERVAL_MS);
    }

    function stopPolling() {
      if (pollId === null) return;
      window.clearInterval(pollId);
      pollId = null;
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshModules();
        startPolling();
      } else {
        stopPolling();
      }
    }

    function handleServiceWorkerMessage(event) {
      if (event.data?.type?.endsWith("-changed")) refreshModules();
    }

    startPolling();
    window.addEventListener("focus", refreshModules);
    window.addEventListener("roomie:book-club-changed", refreshModules);
    window.addEventListener("roomie:shows-changed", refreshModules);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    navigator.serviceWorker?.addEventListener(
      "message",
      handleServiceWorkerMessage,
    );

    return () => {
      stopPolling();
      window.removeEventListener("focus", refreshModules);
      window.removeEventListener("roomie:book-club-changed", refreshModules);
      window.removeEventListener("roomie:shows-changed", refreshModules);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      navigator.serviceWorker?.removeEventListener(
        "message",
        handleServiceWorkerMessage,
      );
    };
  }, [refreshModules]);

  return {
    modules,
    loading: loadedGroupId !== groupId,
    error,
    refreshModules,
  };
}

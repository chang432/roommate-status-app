import { useCallback, useEffect, useRef, useState } from "react";
import { getFeed } from "../api/feed.js";
import { GROUP_FEED_MODULE_IDS } from "../models/groupModules.js";
import { createModules } from "../models/modules.js";

const FEED_POLL_INTERVAL_MS = 5000;
const GROUP_FEED_MODULE_ID_SET = new Set(GROUP_FEED_MODULE_IDS);

function typeKey(enabledModuleIds) {
  if (enabledModuleIds === null) return null;
  if (enabledModuleIds === "all") return "all";
  // Group configuration also contains independently loaded UI modules such as
  // the roster; only registered feed sources belong in the /api/feed request.
  return [
    ...new Set(
      enabledModuleIds.filter((moduleId) =>
        GROUP_FEED_MODULE_ID_SET.has(moduleId),
      ),
    ),
  ]
    .sort()
    .join(",");
}
export default function useGroupModules(
  userId,
  groupId,
  enabledModuleIds = "all",
) {
  const [modules, setModules] = useState([]);
  const [loadedRequestKey, setLoadedRequestKey] = useState(null);
  const [error, setError] = useState("");
  const requestedTypeKey = typeKey(enabledModuleIds);
  const requestKey =
    requestedTypeKey === null ? null : `${groupId}:${requestedTypeKey}`;
  const activeRequestKeyRef = useRef(requestKey);
  const inFlightRef = useRef(null);
  activeRequestKeyRef.current = requestKey;

  const refreshModules = useCallback(async () => {
    if (requestKey === null) return false;
    if (requestedTypeKey === "") {
      setModules([]);
      setError("");
      setLoadedRequestKey(requestKey);
      return true;
    }

    const existing = inFlightRef.current;
    if (existing?.key === requestKey) {
      // Coalesce bursts, but preserve one trailing refresh so a mutation that
      // lands during an older poll cannot be hidden by that poll's response.
      existing.refreshAgain = true;
      return existing.promise;
    }

    const flight = { key: requestKey, promise: null, refreshAgain: false };
    flight.promise = (async () => {
      let succeeded = false;
      try {
        do {
          flight.refreshAgain = false;
          try {
            const requestedTypes =
              requestedTypeKey === "all"
                ? "all"
                : requestedTypeKey.split(",");
            const nextModules = createModules(
              await getFeed(userId, requestedTypes, groupId),
            );
            if (activeRequestKeyRef.current !== requestKey) return false;
            setModules(nextModules);
            setError("");
            succeeded = true;
          } catch {
            if (activeRequestKeyRef.current !== requestKey) return false;
            setError("Could not load the group feed.");
            succeeded = false;
          }
        } while (
          flight.refreshAgain &&
          activeRequestKeyRef.current === requestKey
        );
        return succeeded;
      } finally {
        if (inFlightRef.current === flight) inFlightRef.current = null;
        if (activeRequestKeyRef.current === requestKey) {
          setLoadedRequestKey(requestKey);
        }
      }
    })();
    inFlightRef.current = flight;
    return flight.promise;
  }, [groupId, requestKey, requestedTypeKey, userId]);

  useEffect(() => {
    setLoadedRequestKey(null);
    setModules([]);
    setError("");
    if (requestKey === null) return;
    if (requestedTypeKey === "") {
      setLoadedRequestKey(requestKey);
      return;
    }
    refreshModules();
  }, [refreshModules, requestKey, requestedTypeKey]);

  useEffect(() => {
    if (requestKey === null || requestedTypeKey === "") return undefined;
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
  }, [refreshModules, requestKey, requestedTypeKey]);

  return {
    modules,
    loading: requestKey === null || loadedRequestKey !== requestKey,
    error,
    refreshModules,
  };
}

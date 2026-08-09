import { useCallback, useEffect, useMemo } from "react";
import {
  moduleFocusFromSearchParams,
  withoutModuleFocus,
} from "../../utils/moduleFocus.js";

export default function useFeedFocus({
  feedError,
  loading,
  moduleTypes,
  modules,
  mutationError,
  searchParams,
  setActiveType,
  setArchivedOpen,
  setNavigationError,
  setSearchParams,
}) {
  const focusIntent = useMemo(
    () => moduleFocusFromSearchParams(searchParams),
    [searchParams],
  );
  const moduleTypeIds = useMemo(
    () =>
      new Set(
        moduleTypes.filter((type) => type.id !== "all").map((type) => type.id),
      ),
    [moduleTypes],
  );

  const consumeFocusIntent = useCallback(
    (token) => {
      setSearchParams(
        (currentParams) => {
          const currentIntent = moduleFocusFromSearchParams(currentParams);
          return currentIntent?.token === token
            ? withoutModuleFocus(currentParams)
            : currentParams;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Consume a deep link only when the selected module can actually be rendered.
  useEffect(() => {
    if (!focusIntent) return;
    if (focusIntent.type === "spotify") {
      setNavigationError("");
      consumeFocusIntent(focusIntent.token);
      return;
    }
    if (!moduleTypeIds.has(focusIntent.type)) {
      setNavigationError("That module type is not available.");
      consumeFocusIntent(focusIntent.token);
      return;
    }

    setActiveType(focusIntent.type);
    if (!focusIntent.itemId) {
      setNavigationError("");
      consumeFocusIntent(focusIntent.token);
      return;
    }
    if (loading || feedError || mutationError) return;

    const target = modules.find(
      (module) =>
        module.type === focusIntent.type && module.id === focusIntent.itemId,
    );
    if (!target) {
      setNavigationError("That module is no longer available.");
      consumeFocusIntent(focusIntent.token);
      return;
    }

    setNavigationError("");
    if (target.isArchived) setArchivedOpen(true);
  }, [
    consumeFocusIntent,
    feedError,
    focusIntent,
    loading,
    moduleTypeIds,
    modules,
    mutationError,
    setActiveType,
    setArchivedOpen,
    setNavigationError,
  ]);

  return { consumeFocusIntent, focusIntent };
}


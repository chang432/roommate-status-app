import { useCallback, useEffect, useMemo, useState } from "react";
import { FEED_MODULE_REGISTRY, FEED_MODULE_TYPES } from "./feedModuleRegistry.jsx";
import {
  MODULE_PREFERENCE_VERSION,
  modulePreferenceKey,
  readModulePreferences,
} from "./modulePreferences.js";

export default function useFeedPreferences(user, enabledModuleIds) {
  const [activeType, setActiveType] = useState("all");
  const [moduleOrder, setModuleOrder] = useState(
    () => readModulePreferences(user.id, user.activeGroupId).order,
  );
  const [allTypes, setAllTypes] = useState(
    () => readModulePreferences(user.id, user.activeGroupId).allTypes,
  );

  const enabledTypeIds = useMemo(
    () =>
      new Set(
        Object.keys(FEED_MODULE_REGISTRY).filter((id) =>
          enabledModuleIds.includes(id),
        ),
      ),
    [enabledModuleIds],
  );

  const moduleTypes = useMemo(() => {
    const byId = new Map(FEED_MODULE_TYPES.map((type) => [type.id, type]));
    return [
      byId.get("all"),
      ...moduleOrder
        .map((id) => byId.get(id))
        .filter((type) => type && enabledTypeIds.has(type.id)),
    ].filter(Boolean);
  }, [enabledTypeIds, moduleOrder]);

  useEffect(() => {
    if (!moduleTypes.some((type) => type.id === activeType)) {
      setActiveType("all");
    }
  }, [activeType, moduleTypes]);

  useEffect(() => {
    localStorage.setItem(
      modulePreferenceKey(user.id, user.activeGroupId),
      JSON.stringify({
        version: MODULE_PREFERENCE_VERSION,
        order: moduleOrder,
        allTypes,
        knownTypes: moduleOrder,
      }),
    );
  }, [allTypes, moduleOrder, user.activeGroupId, user.id]);

  const reloadPreferences = useCallback(() => {
    const next = readModulePreferences(user.id, user.activeGroupId);
    setModuleOrder(next.order);
    setAllTypes(next.allTypes);
  }, [user.activeGroupId, user.id]);

  const reorderModuleType = useCallback((draggedType, targetType) => {
    setModuleOrder((current) => {
      const next = [...current];
      const fromIndex = next.indexOf(draggedType);
      const toIndex = next.indexOf(targetType);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return current;
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  return {
    activeType,
    allTypes,
    enabledTypeIds,
    moduleTypes,
    reloadPreferences,
    reorderModuleType,
    setActiveType,
    setAllTypes,
  };
}

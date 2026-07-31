import { FEED_MODULE_TYPES } from "./feedModuleRegistry.jsx";

export const MODULE_PREFERENCE_VERSION = 3;

export function modulePreferenceKey(userId, groupId) {
  return `roomie-module-preferences:${userId}:${groupId}`;
}

export function sanitizeModuleOrder(value) {
  const available = FEED_MODULE_TYPES.filter((type) => type.id !== "all").map(
    (type) => type.id,
  );
  const seen = new Set();
  const ordered = Array.isArray(value)
    ? value.filter(
        (id) => available.includes(id) && !seen.has(id) && seen.add(id),
      )
    : [];
  return [...ordered, ...available.filter((id) => !seen.has(id))];
}

export function sanitizeAllTypes(value, orderedTypes) {
  const selected = Array.isArray(value)
    ? value.filter((id) => orderedTypes.includes(id))
    : orderedTypes;
  return selected.length > 0 ? selected : [orderedTypes[0]].filter(Boolean);
}

export function readModulePreferences(userId, groupId) {
  try {
    const stored = JSON.parse(
      localStorage.getItem(modulePreferenceKey(userId, groupId)) || "null",
    );
    const order = sanitizeModuleOrder(stored?.order);
    const allTypes = sanitizeAllTypes(stored?.allTypes, order);
    const version = stored?.version ?? 1;
    // Legacy preferences predate these modules. Add each once while preserving
    // explicit exclusions saved after that module became available.
    if (version < 2 && !allTypes.includes("book-club")) {
      allTypes.push("book-club");
    }
    if (version < 3 && !allTypes.includes("polls")) allTypes.push("polls");
    return { order, allTypes };
  } catch {
    const order = sanitizeModuleOrder(null);
    return { order, allTypes: sanitizeAllTypes(null, order) };
  }
}

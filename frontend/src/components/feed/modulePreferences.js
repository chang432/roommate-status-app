import { FEED_MODULE_TYPES } from "./feedModuleRegistry.jsx";

export const MODULE_PREFERENCE_VERSION = 6;

export function modulePreferenceKey(userId, groupId) {
  return `roomie-module-preferences:${userId}:${groupId}`;
}

export function sanitizeModuleOrder(value) {
  const available = FEED_MODULE_TYPES.filter((type) => type.id !== "all").map(
    (type) => type.id,
  );
  return sanitizeModuleOrderForTypes(value, available);
}

export function sanitizeAllTypes(value, orderedTypes) {
  const selected = Array.isArray(value)
    ? value.filter((id) => orderedTypes.includes(id))
    : orderedTypes;
  return selected.length > 0 ? selected : [orderedTypes[0]].filter(Boolean);
}

export function normalizeModulePreferences(stored, availableTypes = null) {
  const order = availableTypes
    ? sanitizeModuleOrderForTypes(stored?.order, availableTypes)
    : sanitizeModuleOrder(stored?.order);
  const allTypes = sanitizeAllTypes(stored?.allTypes, order);
  const previouslyKnownTypes = Array.isArray(stored?.knownTypes)
    ? stored.knownTypes
    : Array.isArray(stored?.order)
      ? stored.order
      : [];

  // The saved order is also a durable snapshot of what existed when legacy
  // preferences were written. Registry additions are selected exactly once;
  // after the next save, a user's explicit All-category choices take priority.
  order.forEach((type) => {
    if (!previouslyKnownTypes.includes(type) && !allTypes.includes(type)) {
      allTypes.push(type);
    }
  });
  return { order, allTypes, knownTypes: order };
}

function sanitizeModuleOrderForTypes(value, available) {
  const seen = new Set();
  const ordered = Array.isArray(value)
    ? value.filter(
        (id) => available.includes(id) && !seen.has(id) && seen.add(id),
      )
    : [];
  return [...ordered, ...available.filter((id) => !seen.has(id))];
}

export function readModulePreferences(userId, groupId) {
  try {
    const stored = JSON.parse(
      localStorage.getItem(modulePreferenceKey(userId, groupId)) || "null",
    );
    return normalizeModulePreferences(stored);
  } catch {
    return normalizeModulePreferences(null);
  }
}

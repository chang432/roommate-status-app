export function createModule(feedItem) {
  const createdAt = Number(feedItem.createdAt);
  const updatedAt = Number(feedItem.updatedAt ?? feedItem.createdAt);

  return {
    id: feedItem.id,
    type: feedItem.type,
    createdAt,
    updatedAt,
    sortAt: Number(feedItem.sortAt ?? updatedAt ?? createdAt),
    title: feedItem.title || "Module",
    subtitle: feedItem.subtitle || "",
    actor: feedItem.actor || "Someone",
    isArchived: Boolean(feedItem.isArchived),
    payload: feedItem.payload || {},
  };
}

export function createModules(feedItems) {
  return feedItems
    .map(createModule)
    // A material edit updates sortAt and intentionally returns that module to
    // the top; createdAt is a deterministic fallback for equal timestamps.
    .sort((a, b) => b.sortAt - a.sortAt || b.createdAt - a.createdAt);
}

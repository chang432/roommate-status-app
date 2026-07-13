export function moduleFocusFromSearchParams(searchParams) {
  const type = searchParams.get("module")?.trim();
  if (!type) return null;

  const itemId = searchParams.get("item")?.trim() || null;
  return {
    type,
    itemId,
    token: `${type}:${itemId ?? "filter"}`,
  };
}

export function withoutModuleFocus(searchParams) {
  const nextParams = new URLSearchParams(searchParams);
  nextParams.delete("module");
  nextParams.delete("item");
  return nextParams;
}

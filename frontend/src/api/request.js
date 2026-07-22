const API_BASE = "/api";
const SESSION_KEY = "roomie-session";

// AuthContext registers this callback so a locally reseeded database clears a
// session as soon as the backend identifies its user as invalid.
let onInvalidUser = null;

export function setInvalidUserHandler(handler) {
  onInvalidUser = handler;
}

// All domain clients use this wrapper so error handling and active-group
// scoping remain identical regardless of which endpoint they call.
export async function request(path, options = {}) {
  let activeGroupId = null;
  try {
    activeGroupId =
      JSON.parse(localStorage.getItem(SESSION_KEY) || "null")?.activeGroupId ||
      null;
  } catch {
    // AuthContext handles malformed local sessions; omit group scope here.
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(activeGroupId ? { "X-Roomie-Group-ID": activeGroupId } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (data?.code === "invalid_user") onInvalidUser?.();
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }
  return data;
}

export function withQuery(path, params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, value);
    }
  });
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

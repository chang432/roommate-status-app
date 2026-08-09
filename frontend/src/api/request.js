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
    const error = new Error(data?.error || `Request failed: ${response.status}`);
    error.code = data?.code;
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

export function withQuery(path, params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((entry) => {
      if (entry !== undefined && entry !== null && entry !== "") {
        search.append(key, entry);
      }
    });
  });
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

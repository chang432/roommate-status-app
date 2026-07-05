// In-memory MOCK backend for the TV show tracker feature.
//
// This stands in for a real Flask + DynamoDB module (see the plan in
// docs/tv-show-tracker-plan.md). It lets the Shows tab work end-to-end with
// just `npm run dev` — no server or DynamoDB required. Every function is async
// and returns the full, refreshed show list so callers mirror the real API
// contract exactly; swapping these for real `/api/shows` fetches later requires
// no changes in the components.
//
// State lives only in this module's closure, so it resets on page reload.

// A projected show looks like:
//   { id, title, createdBy, createdById, createdAt, completedAt, completed,
//     members: [ { id, name, season, episode } ] }
// where `members` are the roommates watching, each tracking their own season
// and episode. `completed` is a convenience flag derived from `completedAt`;
// only the creator may toggle it, and completed shows are hidden by default.

const SIMULATED_LATENCY_MS = 120;

function newId() {
  // crypto.randomUUID is available in every browser this app targets; the hex
  // form mirrors the uuid4().hex ids the real DynamoDB modules generate.
  return crypto.randomUUID().replace(/-/g, "");
}

// Seeded so the tab demonstrates the expanded episode UI on first load. These
// member ids are synthetic (they don't map to real roommates), which is fine
// for a mock: names render directly and the +/- pills key off member id.
const shows = [
  {
    id: newId(),
    title: "Severance",
    createdBy: "Sam",
    createdById: "seed-sam",
    createdAt: Date.now() - 1000 * 60 * 60 * 6,
    completedAt: null,
    members: [
      { id: "seed-sam", name: "Sam", season: 2, episode: 5 },
      { id: "seed-alex", name: "Alex", season: 1, episode: 3 },
    ],
  },
];

// Return a deep copy so callers can never mutate the store by reference — the
// same isolation a real network round-trip would give.
function snapshot() {
  return shows
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((show) => ({
      ...show,
      completed: Boolean(show.completedAt),
      members: show.members.map((member) => ({ ...member })),
    }));
}

// Resolve after a short delay with a fresh snapshot, imitating a REST response.
function respond() {
  return new Promise((resolve) =>
    setTimeout(() => resolve(snapshot()), SIMULATED_LATENCY_MS),
  );
}

function findShow(showId) {
  return shows.find((show) => show.id === showId) ?? null;
}

export async function getShows() {
  return respond();
}

// Create a show and auto-join the creator so the row has an initial watcher.
export async function createShow(title, createdById, createdByName) {
  const trimmed = (title || "").trim();
  if (!trimmed) throw new Error("A show title is required.");
  shows.push({
    id: newId(),
    title: trimmed,
    createdBy: createdByName,
    createdById,
    createdAt: Date.now(),
    completedAt: null,
    members: [{ id: createdById, name: createdByName, season: 1, episode: 1 }],
  });
  return respond();
}

// Add a roommate to a show's watcher list (idempotent by roommate id).
export async function joinShow(showId, userId, userName) {
  const show = findShow(showId);
  if (!show) throw new Error("Unknown show.");
  if (!show.members.some((member) => member.id === userId)) {
    show.members.push({ id: userId, name: userName, season: 1, episode: 1 });
  }
  return respond();
}

// Remove a roommate from a show's watcher list.
export async function leaveShow(showId, userId) {
  const show = findShow(showId);
  if (!show) throw new Error("Unknown show.");
  show.members = show.members.filter((member) => member.id !== userId);
  return respond();
}

// Mark a show completed so it drops out of the active list. Only the creator
// may do this, mirroring the owner-only lifecycle controls on activities.
export async function completeShow(showId, requesterId) {
  const show = findShow(showId);
  if (!show) throw new Error("Unknown show.");
  if (show.createdById !== requesterId) {
    throw new Error("Only the show's creator can complete it.");
  }
  show.completedAt = Date.now();
  return respond();
}

// Reopen a completed show back into the active list. Creator-only, so the
// completion can be undone the same way an owner restarts an expired activity.
export async function reopenShow(showId, requesterId) {
  const show = findShow(showId);
  if (!show) throw new Error("Unknown show.");
  if (show.createdById !== requesterId) {
    throw new Error("Only the show's creator can reopen it.");
  }
  show.completedAt = null;
  return respond();
}

// Season and episode are both 1-based, so every progress value clamps here.
const PROGRESS_FIELDS = new Set(["season", "episode"]);

function requireMember(showId, memberId) {
  const show = findShow(showId);
  if (!show) throw new Error("Unknown show.");
  const member = show.members.find((candidate) => candidate.id === memberId);
  if (!member) throw new Error("Unknown watcher.");
  return member;
}

function requireField(field) {
  if (!PROGRESS_FIELDS.has(field)) throw new Error("Unknown progress field.");
}

// Nudge one member's season or episode by delta (+1 / -1), clamped at 1. Anyone
// may edit anyone's number, matching the feature's intentionally loose
// ownership. Season and episode are tracked independently.
export async function adjustProgress(showId, memberId, field, delta) {
  requireField(field);
  const member = requireMember(showId, memberId);
  member[field] = Math.max(1, member[field] + delta);
  return respond();
}

// Set one member's season or episode to an absolute value, clamped at 1. Backs
// the long-press manual editor; like adjustProgress, anyone may edit any number.
export async function setProgress(showId, memberId, field, value) {
  requireField(field);
  const member = requireMember(showId, memberId);
  member[field] = Math.max(1, Math.floor(value));
  return respond();
}

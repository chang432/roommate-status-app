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
//   { id, title, createdBy, createdById, createdAt,
//     members: [ { id, name, episode } ] }
// where `members` are the roommates watching, each tracking their own episode.

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
    members: [
      { id: "seed-sam", name: "Sam", episode: 5 },
      { id: "seed-alex", name: "Alex", episode: 3 },
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
    members: [{ id: createdById, name: createdByName, episode: 1 }],
  });
  return respond();
}

// Add a roommate to a show's watcher list (idempotent by roommate id).
export async function joinShow(showId, userId, userName) {
  const show = findShow(showId);
  if (!show) throw new Error("Unknown show.");
  if (!show.members.some((member) => member.id === userId)) {
    show.members.push({ id: userId, name: userName, episode: 1 });
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

// Nudge one member's episode by delta (+1 / -1), clamped at 0. Anyone may edit
// anyone's number, matching the feature's intentionally loose ownership.
export async function adjustEpisode(showId, memberId, delta) {
  const show = findShow(showId);
  if (!show) throw new Error("Unknown show.");
  const member = show.members.find((candidate) => candidate.id === memberId);
  if (!member) throw new Error("Unknown watcher.");
  member.episode = Math.max(0, member.episode + delta);
  return respond();
}

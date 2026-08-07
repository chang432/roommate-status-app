export const GROUP_MODULE_DEFINITIONS = [
  { id: "roster", label: "Household roster", description: "Roommate statuses and household actions." },
  { id: "events", label: "Events", description: "Plans, live events, and attendance." },
  { id: "requests", label: "Requests", description: "Requests and roommate responses." },
  { id: "checklists", label: "Checklists", description: "Shared lists and completion tracking." },
  { id: "polls", label: "Polls", description: "Group questions and voting." },
  { id: "tv", label: "TV", description: "Shared shows and watch parties." },
  { id: "spotify", label: "Spotify Jam", description: "Share or join the active group Jam." },
  { id: "book-club", label: "Book Club", description: "Books, meetings, reviews, and rotations." },
  { id: "forums", label: "Book forums", description: "Book-linked group discussions." },
];

export const GROUP_MODULE_IDS = GROUP_MODULE_DEFINITIONS.map(({ id }) => id);

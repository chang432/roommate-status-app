export const GROUP_MODULE_DEFINITIONS = [
  {
    id: "roster",
    label: "Household roster",
    description: "Roommate statuses and household actions.",
    feedBacked: false,
  },
  {
    id: "events",
    label: "Events",
    description: "Plans, live events, and attendance.",
    feedBacked: true,
  },
  {
    id: "requests",
    label: "Requests",
    description: "Requests and roommate responses.",
    feedBacked: true,
  },
  {
    id: "checklists",
    label: "Checklists",
    description: "Shared lists and completion tracking.",
    feedBacked: true,
  },
  {
    id: "polls",
    label: "Polls",
    description: "Group questions and voting.",
    feedBacked: true,
  },
  {
    id: "counters",
    label: "Counters",
    description: "Automatic day trackers and shared manual counts.",
    feedBacked: true,
  },
  {
    id: "tv",
    label: "TV",
    description: "Shared shows and watch parties.",
    feedBacked: true,
  },
  {
    id: "spotify",
    label: "Spotify Jam",
    description: "Share or join the active group Jam.",
    feedBacked: true,
  },
  {
    id: "book-club",
    label: "Book Club",
    description: "Books, meetings, reviews, and rotations.",
    feedBacked: true,
  },
  {
    id: "forums",
    label: "Book forums",
    description: "Book-linked group discussions.",
    feedBacked: true,
  },
];

export const GROUP_MODULE_IDS = GROUP_MODULE_DEFINITIONS.map(({ id }) => id);
export const GROUP_FEED_MODULE_IDS = GROUP_MODULE_DEFINITIONS.filter(
  ({ feedBacked }) => feedBacked,
).map(({ id }) => id);

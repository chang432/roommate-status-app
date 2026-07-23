# Yorkshire Roomie Status — Frontend

A small React + Tailwind CSS web app where housemates set and view each other's
availability to hang out. Built from the mockups in `../mockups`.

## Features

- **Login** with a username and password on `/login`, or create a new account
  on `/signup`.
- **Pending accounts** can sign in but cannot use household features until a
  group code assigns them to a household.
- **Profile settings** keep account actions in one place, including sign out,
  account deletion, System/Light/Dark/Forest appearance preferences, and the
  current household invite code for grouped users. Group admins can also choose
  whether the household roster, Book Club, and group feed are shown to everyone
  in that group. Theme choices are stored on the current device.
- **View** the whole household's current statuses at a glance.
- **Set your status**: _Available to hang_, _Busy with smth_, or a custom
  message.
- **Gather banner**: when 3+ roommates are available, a notification banner
  invites everyone to hang out (PROJECT.md threshold).
- **Scheduled and live events**: activities can have optional start/end times,
  automatically become live, overlap, and leave active feeds when ended.
  Open apps refresh from activity push messages, focus changes, or visible-page
  polling.
- **Comment mentions**: typing `@` suggests household members or `@all`,
  highlights valid mentions, and notifies the selected audience.
- **Comment history**: event panels show the latest 10 comments first and can
  expand to the latest 100 returned by the backend.
- **Comment likes**: roommates can like or unlike other people’s comments and
  see their own reaction state, the total like count, and a popover listing
  who liked each comment.
- **Module feed**: `/feed` contains events, requests, checklists, polls, and TV shows
  in one chronological group feed. Material updates bump the module instance to
  the bottom, and the side drawer/rail filters by module type. Module
  notifications use `/?module=<type>&item=<id>` links that select the matching
  filter, reveal archived items, and focus each target once without replaying
  during feed polling. Swiping the feed switches between the ordered filters,
  the filter drawer can edit that order and the contents of All, and the
  floating `+` creates modules.
- **Book Club meetings**: enabled groups show sticky Book and Snack owner lists
  above the feed. Admins create and complete one meeting module at a time;
  members can record attendance and reading progress until completion.
- **Requests**: the household board lets users ask specific roommates for
  help, track accept/deny responses, comment, archive or restore requests, and open
  module notifications directly to the expanded request card.
- **Checklists**: the shire board includes shared checklists that can be
  posted, expanded, added to, checked off by multiple roommates, notified, archived,
  restored, or deleted.
- **Polls**: roommate and Book Club groups can create standalone, multi-select
  polls. Everyone can add options and vote; creators edit poll and option text,
  while any current member can archive, restore, or delete.

## Tech

- [Vite](https://vitejs.dev/) + React 18
- [Tailwind CSS](https://tailwindcss.com/) (semantic theme tokens in
  `src/styles/themes.css`, exposed through `tailwind.config.js`)
- [React Router](https://reactrouter.com/) for `/login`, `/signup`, `/pending`,
  `/feed`, and `/`

## Getting started

Start the [Flask backend](../docker/flask) first (it serves the API on
`http://localhost:8000`, the Vite proxy target), then run the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open the printed local URL. Sign in as any seeded roommate using their lowercase
name as username (for example `andre`) with the demo password **`roomie`**.

## Module feed behavior

The **All** filter is customizable per user and group. Book Club starts
selected after a one-time preference upgrade; explicit exclusions made after
that remain saved. To edit a module, expand its card and use the **Edit** action
at the bottom. The action is shown only when the current user can edit that
active instance.

## Backend / API

Backend calls live in domain modules under `src/api/`, which share a request
helper and target the Flask server (`../docker/flask`) under `/api`:

| Function                        | Method & path                                              |
| ------------------------------- | ---------------------------------------------------------- |
| `login`                         | `POST /api/login`                                          |
| `createAccount`                 | `POST /api/accounts`                                       |
| `deleteAccount`                 | `DELETE /api/accounts/:id`                                 |
| `joinGroup`                     | `POST /api/groups/join`                                    |
| `getCurrentGroup`               | `GET /api/groups/current?userId=:id`                       |
| `updateGroupDisplay`            | `PUT /api/groups/display?userId=:id`                       |
| `getBookClubSummary`            | `GET /api/book-club?userId=:id`                            |
| `createBookClubMeeting`         | `POST /api/book-club/meetings?userId=:id`                  |
| `getBookClubMeeting`            | `GET /api/book-club/meetings/:id?userId=:id`               |
| `updateBookClubMeetingResponse` | `PUT /api/book-club/meetings/:id/response?userId=:id`      |
| `completeBookClubMeeting`       | `POST /api/book-club/meetings/:id/complete?userId=:id`     |
| `completeBookClubBook`          | `POST /api/book-club/books/:id/complete?userId=:id`        |
| `getCompletedBookClubBooks`     | `GET /api/book-club/books/completed?userId=:id`            |
| `notifyBookClubMeeting`         | `POST /api/book-club/meetings/:id/notify?userId=:id`       |
| `getRoommates`                  | `GET /api/roommates?userId=:id`                            |
| `updateStatus`                  | `PUT /api/roommates/:id/status`                            |
| `notifyRoommatesToUpdateStatus` | `POST /api/roommates/notify`                               |
| `pokeRoommate`                  | `POST /api/roommates/:id/poke`                             |
| `getFeed`                       | `GET /api/feed?userId=:id&type=:type`                      |
| `updateModule`                  | `PATCH /api/modules/:type/:id`                             |
| `getJam`                        | `GET /api/jam?userId=:id`                                  |
| `getActivities`                 | `GET /api/activities?userId=:id`                           |
| `proposeActivity`               | `POST /api/activities`                                     |
| `archiveActivity`               | `POST /api/activities/:id/archive`                         |
| `restoreActivity`               | `POST /api/activities/:id/restore`                         |
| `deleteActivity`                | `DELETE /api/activities/:id`                               |
| `startActivity`                 | `POST /api/activities/:id/start`                           |
| `endActivity`                   | `POST /api/activities/:id/end`                             |
| `setCommentLiked`               | `PUT/DELETE /api/activities/:id/comments/:commentId/likes` |
| `createRequest`                 | `POST /api/requests`                                       |
| `respondToRequest`              | `POST /api/requests/:id/responses`                         |
| `archiveRequest`                | `POST /api/requests/:id/archive`                           |
| `restoreRequest`                | `POST /api/requests/:id/restore`                           |
| `deleteRequest`                 | `DELETE /api/requests/:id`                                 |
| `commentOnRequest`              | `POST /api/requests/:id/comments`                          |
| `setRequestCommentLiked`        | `PUT/DELETE /api/requests/:id/comments/:commentId/likes`   |
| `createChecklist`               | `POST /api/checklists`                                     |
| `notifyChecklist`               | `POST /api/checklists/:id/notify`                          |
| `addChecklistItem`              | `POST /api/checklists/:id/items`                           |
| `toggleChecklistItem`           | `POST /api/checklists/:id/items/:itemId/toggle`            |
| `updateChecklistItem`           | `PATCH /api/checklists/:id/items/:itemId`                  |
| `deleteChecklistItem`           | `DELETE /api/checklists/:id/items/:itemId`                 |
| `archiveChecklist`              | `POST /api/checklists/:id/archive`                         |
| `startWatchparty`               | `POST /api/shows/:id/watchparty/start`                     |
| `endWatchparty`                 | `POST /api/shows/:id/watchparty/end`                       |
| `restoreChecklist`              | `POST /api/checklists/:id/restore`                         |
| `deleteChecklist`               | `DELETE /api/checklists/:id`                               |
| `createPoll`                    | `POST /api/polls`                                          |
| `addPollOption`                 | `POST /api/polls/:id/options`                              |
| `editPollOption`                | `PATCH /api/polls/:id/options/:optionId`                   |
| `setPollVote`                   | `PUT/DELETE /api/polls/:id/options/:optionId/votes`        |
| `archivePoll`                   | `POST /api/polls/:id/archive`                              |
| `restorePoll`                   | `POST /api/polls/:id/restore`                              |
| `deletePoll`                    | `DELETE /api/polls/:id`                                    |

In dev, Vite proxies `/api` to the backend (default `http://localhost:8000`).
Point at a different server with `VITE_API_TARGET`:

```bash
VITE_API_TARGET=http://localhost:9000 npm run dev
```

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build
- `npm run lint` — lint the source

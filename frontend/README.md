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
- **Book Club**: the household page shows a two-by-two Current Book, Library,
  Book, and Snack card grid. The library opens as a searchable modal with the
  current title first and completed titles by recency, aggregate ratings,
  collapsible reviews, and collapsible meeting discussions. Admins add the
  current title and schedule meetings for it; members can correct catalog books.
  Members review current or completed books with
  1–5 stars, finish status, and an optional note; completed meeting forums
  remain read-only.
- **Requests**: the household board lets users ask specific roommates for
  help, track accept/deny responses, comment, archive or restore requests, and open
  module notifications directly to the expanded request card.
- **Checklists**: the shire board includes shared checklists that can be
  posted, expanded, added to, checked off by multiple roommates, notified, archived,
  restored, or deleted.
- **Polls**: roommate and Book Club groups can create standalone, multi-select
  polls. Everyone can add options and vote; creators edit poll and option text,
  while any current member can archive, restore, or delete. Poll panels also
  support comments, mentions, likes, and inspectable voter lists.

## Tech

- [Vite](https://vitejs.dev/) + React 18
- [Tailwind CSS](https://tailwindcss.com/) (semantic theme tokens in
  `src/styles/themes.css`, exposed through `tailwind.config.js`)
- [React Router](https://reactrouter.com/) for `/login`, `/signup`, `/pending`,
  and `/`

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
| `getBookClub`                   | `GET /api/book-club?userId=:id`                            |
| `createBookClubMeeting`         | `POST /api/book-club/meetings?userId=:id`                  |
| `getBookClubMeetings`           | `GET /api/book-club/meetings?userId=:id`                   |
| `getBookClubMeeting`            | `GET /api/book-club/meetings/:id?userId=:id`               |
| `setBookClubResponse`           | `PUT /api/book-club/meetings/:id/response?userId=:id`      |
| `completeBookClubMeeting`       | `POST /api/book-club/meetings/:id/complete?userId=:id`     |
| `completeBookClubBook`          | `POST /api/book-club/books/:id/complete?userId=:id`        |
| `getBookClubBooks`              | `GET /api/book-club/books?userId=:id`                      |
| `addBookClubBook`               | `POST /api/book-club/books?userId=:id`                     |
| `updateBookClubBook`            | `PATCH /api/book-club/books/:id?userId=:id`                |
| `reviewBookClubBook`            | `PUT /api/book-club/books/:id/review?userId=:id`           |
| `notifyBookClubMeeting`         | `POST /api/book-club/meetings/:id/notify?userId=:id`       |
| `getBookClubForum`              | `GET /api/book-club/meetings/:id/forum?userId=:id`         |
| `createBookClubForumEntry`      | `POST /api/book-club/meetings/:id/forum?userId=:id`        |
| `updateBookClubForumEntry`      | `PATCH /api/book-club/meetings/:id/forum/:entryId`         |
| `deleteBookClubForumEntry`      | `DELETE /api/book-club/meetings/:id/forum/:entryId`        |
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
| `commentOnPoll`                 | `POST /api/polls/:id/comments`                             |
| `setPollCommentLiked`           | `PUT/DELETE /api/polls/:id/comments/:commentId/likes`      |
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
- `npm test` — run the Vitest unit tests
- `npm run test:e2e:install` — install Playwright's Chromium browser
- `npm run test:e2e` — run the Playwright browser tests
- `npm run test:e2e:ui` — open Playwright's interactive test runner

## Browser tests

Install Chromium once, then run the end-to-end suite:

```bash
npm run test:e2e:install
npm run test:e2e
```

Playwright starts the Vite development server automatically. Tests can mock
individual API calls with `page.route`, so they do not need a running Flask
backend unless a scenario intentionally exercises the complete stack.

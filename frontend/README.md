# Yorkshire Roomie Status — Frontend

A small React + Tailwind CSS web app where housemates set and view each other's
availability to hang out. Built from the mockups in `../mockups`.

## Features

- **Login** by picking your name and entering a password.
- **View** the whole household's current statuses at a glance.
- **Set your status**: _Available to hang_, _Busy with smth_, or a custom
  message.
- **Gather banner**: when 3+ roommates are available, a notification banner
  invites everyone to hang out (PROJECT.md threshold).
- **Scheduled and live events**: activities can have optional start/end times,
  automatically become live, overlap, and expire into collapsible history.
  Open apps refresh from activity push messages, focus changes, or visible-page
  polling.
- **Comment mentions**: typing `@` suggests household members or `@all`,
  highlights valid mentions, and notifies the selected audience.
- **Comment history**: event panels show the latest 10 comments first and can
  expand to the latest 100 returned by the backend.
- **Comment likes**: roommates can like or unlike other people’s comments and
  see their own reaction state, the total like count, and a popover listing
  who liked each comment.
- **Requests**: a tabbed household board lets users ask specific roommates for
  help, track accept/deny responses, comment, mark requests complete, and open
  request notifications directly to the expanded request card.
- **Checklists**: the shire board includes shared checklists that can be
  posted, expanded, added to, checked off by multiple roommates, notified, and
  archived.

## Tech

- [Vite](https://vitejs.dev/) + React 18
- [Tailwind CSS](https://tailwindcss.com/) (cozy theme tokens in
  `tailwind.config.js`)
- [React Router](https://reactrouter.com/) for `/login` and `/`

## Getting started

Start the [Flask backend](../docker/flask) first (it serves the API on
`http://localhost:8000`, the Vite proxy target), then run the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open the printed local URL. Sign in as any roommate (Andre, Jordan, Maya, Sam,
Priya, Leo) with the demo password **`roomie`**.

## Backend / API

All backend calls live in `src/api/client.js`, which targets the Flask server
(`../docker/flask`) under `/api`:

| Function                        | Method & path                                              |
| ------------------------------- | ---------------------------------------------------------- |
| `login`                         | `POST /api/login`                                          |
| `getRoommates`                  | `GET /api/roommates`                                       |
| `updateStatus`                  | `PUT /api/roommates/:id/status`                            |
| `notifyRoommatesToUpdateStatus` | `POST /api/roommates/notify`                               |
| `pokeRoommate`                  | `POST /api/roommates/:id/poke`                             |
| `proposeActivity`               | `POST /api/activities`                                     |
| `archiveActivity`               | `POST /api/activities/:id/archive`                         |
| `deleteActivity`                | `DELETE /api/activities/:id`                               |
| `startActivity`                 | `POST /api/activities/:id/start`                           |
| `endActivity`                   | `POST /api/activities/:id/end`                             |
| `updateActivitySchedule`        | `PATCH /api/activities/:id/schedule`                       |
| `setCommentLiked`               | `PUT/DELETE /api/activities/:id/comments/:commentId/likes` |
| `getRequests`                   | `GET /api/requests`                                        |
| `createRequest`                 | `POST /api/requests`                                       |
| `respondToRequest`              | `POST /api/requests/:id/responses`                         |
| `completeRequest`               | `POST /api/requests/:id/complete`                          |
| `reopenRequest`                 | `POST /api/requests/:id/reopen`                            |
| `deleteRequest`                 | `DELETE /api/requests/:id`                                 |
| `commentOnRequest`              | `POST /api/requests/:id/comments`                          |
| `setRequestCommentLiked`        | `PUT/DELETE /api/requests/:id/comments/:commentId/likes`   |
| `getChecklists`                 | `GET /api/checklists`                                      |
| `createChecklist`               | `POST /api/checklists`                                     |
| `notifyChecklist`               | `POST /api/checklists/:id/notify`                          |
| `addChecklistItem`              | `POST /api/checklists/:id/items`                           |
| `toggleChecklistItem`           | `POST /api/checklists/:id/items/:itemId/toggle`            |
| `updateChecklistItem`           | `PATCH /api/checklists/:id/items/:itemId`                  |
| `deleteChecklistItem`           | `DELETE /api/checklists/:id/items/:itemId`                 |
| `archiveChecklist`              | `POST /api/checklists/:id/archive`                         |

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

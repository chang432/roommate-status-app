import { request, withQuery } from "./request.js";

export function getBookClub(userId) {
  return request(withQuery("/book-club", { userId }));
}

export function getCompletedBookClubBooks(userId) {
  return request(withQuery("/book-club/books/completed", { userId }));
}

export function configureBookClub(userId, settings) {
  return request(withQuery("/book-club/config", { userId }), {
    method: "POST",
    body: JSON.stringify(settings),
  });
}

export function setBookClubResponse(userId, sessionId, attendanceStatus, chaptersReadThrough) {
  return request(withQuery(`/book-club/sessions/${encodeURIComponent(sessionId)}/response`, { userId }), {
    method: "PUT",
    body: JSON.stringify({ attendanceStatus, chaptersReadThrough }),
  });
}

export function updateBookClubNextSession(userId, settings) {
  return request(withQuery("/book-club/next-session", { userId }), {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function notifyBookClubMeeting(userId, sessionId) {
  return request(withQuery(`/book-club/sessions/${encodeURIComponent(sessionId)}/notify`, { userId }), {
    method: "POST",
  });
}

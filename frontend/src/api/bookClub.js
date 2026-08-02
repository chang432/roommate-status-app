import { request, withQuery } from "./request.js";

export function getBookClub(userId) {
  return request(withQuery("/book-club", { userId }));
}

export function createBookClubMeeting(userId, meeting) {
  return request(withQuery("/book-club/meetings", { userId }), {
    method: "POST",
    body: JSON.stringify(meeting),
  });
}

export function getBookClubMeetings(userId) {
  return request(withQuery("/book-club/meetings", { userId }));
}

export function getBookClubMeeting(userId, meetingId) {
  return request(withQuery(`/book-club/meetings/${encodeURIComponent(meetingId)}`, { userId }));
}

export function setBookClubResponse(userId, meetingId, changes) {
  return request(withQuery(`/book-club/meetings/${encodeURIComponent(meetingId)}/response`, { userId }), {
    method: "PUT",
    body: JSON.stringify(changes),
  });
}

export function completeBookClubMeeting(userId, meetingId) {
  return request(withQuery(`/book-club/meetings/${encodeURIComponent(meetingId)}/complete`, { userId }), {
    method: "POST",
  });
}

export function notifyBookClubMeeting(userId, meetingId) {
  return request(withQuery(`/book-club/meetings/${encodeURIComponent(meetingId)}/notify`, { userId }), {
    method: "POST",
  });
}

export function completeBookClubBook(userId, bookId) {
  return request(withQuery(`/book-club/books/${encodeURIComponent(bookId)}/complete`, { userId }), {
    method: "POST",
  });
}

export function getBookClubBooks(userId) {
  return request(withQuery("/book-club/books", { userId }));
}

export function addBookClubBook(userId, book) {
  return request(withQuery("/book-club/books", { userId }), {
    method: "POST",
    body: JSON.stringify(book),
  });
}

export function updateBookClubBook(userId, bookId, book) {
  return request(withQuery(`/book-club/books/${encodeURIComponent(bookId)}`, { userId }), {
    method: "PATCH",
    body: JSON.stringify(book),
  });
}

export function reviewBookClubBook(userId, bookId, review) {
  return request(withQuery(`/book-club/books/${encodeURIComponent(bookId)}/review`, { userId }), {
    method: "PUT",
    body: JSON.stringify(review),
  });
}

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

export function getBookClubMeeting(userId, meetingId) {
  return request(withQuery(`/book-club/meetings/${encodeURIComponent(meetingId)}`, { userId }));
}

export function setBookClubResponse(userId, meetingId, attendanceStatus, chaptersReadThrough) {
  return request(withQuery(`/book-club/meetings/${encodeURIComponent(meetingId)}/response`, { userId }), {
    method: "PUT",
    body: JSON.stringify({ attendanceStatus, chaptersReadThrough }),
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

export function getCompletedBookClubBooks(userId) {
  return request(withQuery("/book-club/books/completed", { userId }));
}

export function rateBookClubBook(userId, bookId, rating) {
  return request(withQuery(`/book-club/books/${encodeURIComponent(bookId)}/rating`, { userId }), {
    method: "PUT",
    body: JSON.stringify({ rating }),
  });
}

export function getBookClubPosts(userId, bookId, chapterKey) {
  return request(withQuery(`/book-club/books/${encodeURIComponent(bookId)}/posts`, { userId, chapterKey }));
}

export function createBookClubPost(userId, bookId, post) {
  return request(withQuery(`/book-club/books/${encodeURIComponent(bookId)}/posts`, { userId }), {
    method: "POST",
    body: JSON.stringify(post),
  });
}

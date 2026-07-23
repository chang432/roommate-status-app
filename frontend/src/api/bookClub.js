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

export function reviewBookClubBook(userId, bookId, review) {
  return request(withQuery(`/book-club/books/${encodeURIComponent(bookId)}/review`, { userId }), {
    method: "PUT",
    body: JSON.stringify(review),
  });
}

export function getBookClubForum(userId, meetingId) {
  return request(withQuery(`/book-club/meetings/${encodeURIComponent(meetingId)}/forum`, { userId }));
}

export function createBookClubForumEntry(userId, meetingId, entry) {
  return request(withQuery(`/book-club/meetings/${encodeURIComponent(meetingId)}/forum`, { userId }), {
    method: "POST",
    body: JSON.stringify(entry),
  });
}

export function updateBookClubForumEntry(userId, meetingId, entryId, changes) {
  return request(withQuery(`/book-club/meetings/${encodeURIComponent(meetingId)}/forum/${encodeURIComponent(entryId)}`, { userId }), {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export function deleteBookClubForumEntry(userId, meetingId, entryId) {
  return request(withQuery(`/book-club/meetings/${encodeURIComponent(meetingId)}/forum/${encodeURIComponent(entryId)}`, { userId }), {
    method: "DELETE",
  });
}

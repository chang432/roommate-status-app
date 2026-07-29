export const OPEN_BOOK_LIBRARY_ADD_EVENT = "roomie:open-book-library-add";

export function openBookLibraryAdd() {
  window.dispatchEvent(new Event(OPEN_BOOK_LIBRARY_ADD_EVENT));
}

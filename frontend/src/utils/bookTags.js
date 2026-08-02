export const BOOK_TAG_LIMIT = 10;
export const BOOK_TAG_LENGTH = 32;

export function normalizeBookTag(value) {
  return value.trim().replace(/\s+/g, " ");
}

export function collectBookTags(books) {
  const labels = new Map();
  for (const book of books) {
    for (const tag of book.tags ?? []) {
      const normalized = normalizeBookTag(tag);
      if (normalized && !labels.has(normalized.toLocaleLowerCase())) {
        labels.set(normalized.toLocaleLowerCase(), normalized);
      }
    }
  }
  return [...labels.values()].sort((left, right) => left.localeCompare(right));
}

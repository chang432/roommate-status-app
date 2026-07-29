import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import BookClub from "./BookClub.jsx";
import {
  completeBookClubBook,
  getBookClub,
  getBookClubBooks,
} from "../../api/bookClub.js";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));

vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getBookClub: vi.fn(),
  getBookClubBooks: vi.fn(),
  completeBookClubBook: vi.fn(),
}));

const ROOMMATES = [
  { id: "andre", name: "Andre", role: "admin" },
  { id: "kayla", name: "Kayla", role: "member" },
  { id: "sheryl", name: "Sheryl", role: "member" },
];

const ACTIVE_BOOK = {
  id: "book-1",
  title: "Parable of the Sower",
  author: "Octavia E. Butler",
  bookOwnerName: "Kayla",
  isCurrent: true,
  completedAt: null,
  averageRating: null,
  reviewCount: 0,
  finishedCount: 0,
  viewerReview: null,
  reviews: [],
  meetings: [],
};

function summary(book = true) {
  return {
    configuration: {
      bookOwnerOrderUserIds: ["kayla", "andre", "sheryl"],
      snackOwnerOrderUserIds: ["andre", "sheryl", "kayla"],
    },
    activeBook: book ? {
      id: ACTIVE_BOOK.id,
      title: ACTIVE_BOOK.title,
      author: ACTIVE_BOOK.author,
      bookOwnerId: "kayla",
    } : null,
    openMeeting: null,
  };
}

function renderBookClub(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BookClub roommates={ROOMMATES} groupId="book-club" />
    </MemoryRouter>,
  );
}

describe("BookClub cards and library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBookClub.mockResolvedValue({ summary: summary() });
    getBookClubBooks.mockResolvedValue({ books: [ACTIVE_BOOK] });
  });
  afterEach(() => cleanup());

  it("shows Current and Library before the Book and Snack owner cards", async () => {
    renderBookClub();

    const section = screen.getByRole("region", { name: "Book Club" });
    const cards = await within(section).findAllByRole("button");
    expect(cards.slice(0, 5).map((card) => card.textContent)).toEqual([
      expect.stringContaining("Current bookParable of the Sower"),
      "Complete book",
      expect.stringContaining("LibraryAll books"),
      expect.stringContaining("BookKayla"),
      expect.stringContaining("SnackAndre"),
    ]);
  });

  it("opens the library list and current-book detail in the shared modal", async () => {
    renderBookClub();

    await userEvent.click(await screen.findByRole("button", { name: /Library All books/ }));
    expect(screen.getByRole("dialog", { name: "Book library" })).toHaveTextContent("Parable of the Sower");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    await userEvent.click(screen.getByRole("button", { name: /Current book Parable of the Sower/ }));
    const detail = screen.getByRole("dialog", { name: "Book details" });
    expect(detail).toHaveTextContent("Your review");
    expect(detail).toHaveTextContent("Discussions");
    expect(getBookClubBooks).toHaveBeenCalledTimes(2);
  });

  it("opens the add-book flow from an empty current-book card", async () => {
    getBookClub.mockResolvedValue({ summary: summary(false) });
    getBookClubBooks.mockResolvedValue({ books: [] });
    renderBookClub();

    await userEvent.click(await screen.findByRole("button", { name: /Current book No book selected/ }));
    expect(screen.getByRole("dialog", { name: "Add a book" })).toHaveTextContent("Book owner");
  });

  it("offers admins a way to restore a completed book when none is current", async () => {
    getBookClub.mockResolvedValue({ summary: summary(false) });
    getBookClubBooks.mockResolvedValue({ books: [{ ...ACTIVE_BOOK, isCurrent: false, completedAt: 1 }] });
    renderBookClub();

    await userEvent.click(await screen.findByRole("button", { name: /Library All books/ }));
    await userEvent.click(screen.getByRole("button", { name: /Parable of the Sower/ }));
    await userEvent.click(screen.getByRole("button", { name: "Edit book" }));

    expect(screen.getByRole("button", { name: "Set as current" })).toBeInTheDocument();
  });

  it("keeps owner order dialogs and meeting snapshots authoritative", async () => {
    getBookClub.mockResolvedValue({
      summary: {
        ...summary(),
        openMeeting: { bookOwnerId: "andre", snackOwnerId: "sheryl" },
      },
    });
    renderBookClub();

    await userEvent.click(await screen.findByRole("button", { name: /Book Andre/ }));
    const dialog = screen.getByRole("dialog", { name: "Book owner order" });
    expect(dialog).toHaveTextContent("KaylaDefault owner");
    expect(dialog).toHaveTextContent("AndreCurrent owner");
  });

  it("lets an admin complete the active book", async () => {
    completeBookClubBook.mockResolvedValue({ summary: summary(false) });
    renderBookClub();

    await userEvent.click(await screen.findByRole("button", { name: "Complete book" }));
    expect(completeBookClubBook).toHaveBeenCalledWith("andre", "book-1");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Complete book" })).not.toBeInTheDocument());
  });

  it("opens a notification-linked book directly and reloads shared changes", async () => {
    renderBookClub("/?book=book-1&meeting=meeting%231&thread=topic%231");

    expect(await screen.findByRole("dialog", { name: "Book details" })).toHaveTextContent("Parable of the Sower");
    window.dispatchEvent(new Event("roomie:book-club-changed"));
    await waitFor(() => expect(getBookClub).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getBookClubBooks).toHaveBeenCalledTimes(2));
  });
});

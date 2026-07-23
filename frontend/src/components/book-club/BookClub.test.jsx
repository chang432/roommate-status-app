import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookClub from "./BookClub.jsx";
import { completeBookClubBook, getBookClub } from "../../api/bookClub.js";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));

vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getBookClub: vi.fn(),
  completeBookClubBook: vi.fn(),
}));

const ROOMMATES = [
  { id: "andre", name: "Andre", role: "admin" },
  { id: "kayla", name: "Kayla", role: "member" },
  { id: "sheryl", name: "Sheryl", role: "member" },
];

function summary(book = true) {
  return {
    configuration: {
      bookOwnerOrderUserIds: ["kayla", "andre", "sheryl"],
      snackOwnerOrderUserIds: ["andre", "sheryl", "kayla"],
    },
    activeBook: book ? { id: "book-1", title: "Parable of the Sower" } : null,
    openMeeting: null,
  };
}

describe("BookClub owner lists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBookClub.mockResolvedValue({ summary: summary() });
  });
  afterEach(() => cleanup());

  it("shows both prior owners and their full stored order", async () => {
    render(<BookClub roommates={ROOMMATES} groupId="book-club" />);

    const bookTracker = await screen.findByRole("button", { name: /Book Kayla/ });
    expect(screen.getByRole("button", { name: /Snack Andre/ })).toBeInTheDocument();
    const currentBook = screen.getByText(/Current book:/).closest("div");
    expect(
      currentBook.compareDocumentPosition(bookTracker)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await userEvent.click(bookTracker);
    const dialog = screen.getByRole("dialog", { name: "Book owner order" });
    expect(dialog).toHaveTextContent("KaylaCurrent and default owner");
    expect(dialog).toHaveTextContent("AndreOrder #2");
    expect(dialog).toHaveTextContent("SherylOrder #3");
  });

  it("shows the active meeting owners even when the stored defaults differ", async () => {
    getBookClub.mockResolvedValue({
      summary: {
        ...summary(),
        openMeeting: {
          bookOwnerId: "andre",
          snackOwnerId: "sheryl",
        },
      },
    });
    render(<BookClub roommates={ROOMMATES} groupId="book-club" />);

    const bookTracker = await screen.findByRole("button", { name: /Book Andre/ });
    expect(screen.getByRole("button", { name: /Snack Sheryl/ })).toBeInTheDocument();

    await userEvent.click(bookTracker);
    const dialog = screen.getByRole("dialog", { name: "Book owner order" });
    expect(dialog).toHaveTextContent("KaylaDefault owner");
    expect(dialog).toHaveTextContent("AndreCurrent owner");
  });

  it("lets an admin complete the active book without changing meetings", async () => {
    completeBookClubBook.mockResolvedValue({ summary: summary(false) });
    render(<BookClub roommates={ROOMMATES} groupId="book-club" />);

    await userEvent.click(await screen.findByRole("button", { name: "Complete book" }));
    expect(completeBookClubBook).toHaveBeenCalledWith("andre", "book-1");
    await waitFor(() => expect(screen.queryByText("Current book:")).not.toBeInTheDocument());
  });

  it("reloads after the shared Book Club change event", async () => {
    getBookClub
      .mockResolvedValueOnce({ summary: summary() })
      .mockResolvedValueOnce({ summary: {
        ...summary(),
        configuration: {
          bookOwnerOrderUserIds: ["andre", "kayla", "sheryl"],
          snackOwnerOrderUserIds: ["andre", "sheryl", "kayla"],
        },
      } });
    render(<BookClub roommates={ROOMMATES} groupId="book-club" />);
    await screen.findByRole("button", { name: /Book Kayla/ });

    window.dispatchEvent(new Event("roomie:book-club-changed"));
    expect(await screen.findByRole("button", { name: /Book Andre/ })).toBeInTheDocument();
  });
});

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

    expect(await screen.findByRole("button", { name: /Book Kayla/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Snack Andre/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Book Kayla/ }));
    const dialog = screen.getByRole("dialog", { name: "Book owner order" });
    expect(dialog).toHaveTextContent("KaylaCurrent and default owner");
    expect(dialog).toHaveTextContent("AndreOrder #2");
    expect(dialog).toHaveTextContent("SherylOrder #3");
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

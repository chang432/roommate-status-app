import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookClubMeetingForm from "./BookClubMeetingForm.jsx";
import { createBookClubMeeting, getBookClub, getBookClubBooks } from "../../api/bookClub.js";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre" } }),
}));
vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getBookClub: vi.fn(),
  getBookClubBooks: vi.fn(),
  createBookClubMeeting: vi.fn(),
}));
vi.mock("../../api/feed.js", () => ({ updateModule: vi.fn() }));

const ROOMMATES = [
  { id: "andre", name: "Andre" },
  { id: "kayla", name: "Kayla" },
];

describe("BookClubMeetingForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBookClub.mockResolvedValue({
      summary: {
        configuration: {
          suggestedMeetingAt: Date.UTC(2030, 7, 7, 23, 30),
          bookOwnerOrderUserIds: ["kayla", "andre"],
          snackOwnerOrderUserIds: ["andre", "kayla"],
        },
        activeBook: { id: "book-1", title: "A Book", author: "An Author" },
      },
    });
    getBookClubBooks.mockResolvedValue({
      books: [{
        id: "book-1", title: "A Book", author: "An Author",
        bookOwnerId: "kayla", bookOwnerName: "Kayla", status: "active", isCurrent: true,
      }],
    });
    createBookClubMeeting.mockResolvedValue({ meeting: { id: "meeting#1" } });
  });
  afterEach(() => cleanup());

  it("selects a catalog book and loops the Snack owner", async () => {
    render(<BookClubMeetingForm roommates={ROOMMATES} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByRole("combobox", { name: /Book/ })).toHaveValue("book-1");
    expect(screen.getByText("Book owner: Kayla")).toBeInTheDocument();
    const snackOwner = screen.getByRole("button", { name: /Snack owner Andre/ });
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const createButton = screen.getByRole("button", { name: "Create meeting" });
    expect(cancelButton).toHaveClass("ui-secondaryButton", "ui-formActionButton");
    expect(createButton).toHaveClass("ui-primaryButton", "ui-formActionButton");
    expect(cancelButton.nextElementSibling).toBe(createButton);

    await userEvent.click(snackOwner);
    expect(screen.getByRole("listbox", { name: "Snack owner" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Reading target"), "Chapter 2");
    await userEvent.click(screen.getByRole("button", { name: "Create meeting" }));

    expect(createBookClubMeeting).toHaveBeenCalledWith(
      "andre",
      expect.objectContaining({ bookId: "book-1", snackOwnerId: "andre" }),
    );
  });

  it("sends users to add a book when the catalog has no available books", async () => {
    getBookClubBooks.mockResolvedValue({ books: [] });
    const onCancel = vi.fn();
    render(<BookClubMeetingForm roommates={ROOMMATES} onSaved={vi.fn()} onCancel={onCancel} />);
    const changed = vi.fn();
    window.addEventListener("roomie:open-book-library-add", changed, { once: true });
    await userEvent.click(await screen.findByRole("button", { name: "Add a book" }));
    expect(onCancel).toHaveBeenCalled();
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
  });
});

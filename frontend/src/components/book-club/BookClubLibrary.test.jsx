import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewBookClubBook } from "../../api/bookClub.js";
import BookClubLibrary from "./BookClubLibrary.jsx";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  reviewBookClubBook: vi.fn(),
}));

const BOOK = {
  id: "book-1",
  title: "Parable of the Sower",
  author: "Octavia E. Butler",
  bookOwnerName: "Kayla",
  completedAt: Date.UTC(2030, 0, 1),
  averageRating: 4,
  reviewCount: 1,
  finishedCount: 0,
  viewerReview: {
    userId: "andre",
    userName: "Andre",
    rating: 4,
    finished: null,
    note: "",
  },
  reviews: [{
    userId: "andre",
    userName: "Andre",
    rating: 4,
    finished: null,
    note: "",
  }],
};

describe("BookClubLibrary", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("preserves legacy ratings and requires finish status on update", async () => {
    const updatedBook = {
      ...BOOK,
      finishedCount: 1,
      viewerReview: { ...BOOK.viewerReview, finished: true },
      reviews: [{ ...BOOK.reviews[0], finished: true }],
    };
    reviewBookClubBook.mockResolvedValue({ books: [updatedBook] });
    const onBooksChange = vi.fn();
    render(<BookClubLibrary books={[BOOK]} onBooksChange={onBooksChange} />);

    expect(screen.getAllByText("Finish status not recorded").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Update review" })).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: "Finished" }));
    await userEvent.type(screen.getByPlaceholderText("What stayed with you?"), "Still thinking about it.");
    await userEvent.click(screen.getByRole("button", { name: "Update review" }));

    expect(reviewBookClubBook).toHaveBeenCalledWith("andre", "book-1", {
      rating: 4,
      finished: true,
      note: "Still thinking about it.",
    });
    expect(onBooksChange).toHaveBeenCalledWith([updatedBook]);
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });
});

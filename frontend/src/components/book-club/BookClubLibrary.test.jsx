import { cleanup, render, screen, within } from "@testing-library/react";
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

const ACTIVE_BOOK = {
  id: "active-book",
  title: "Parable of the Sower",
  author: "Octavia E. Butler",
  bookOwnerName: "Kayla",
  tags: ["Speculative Fiction", "Bechdel Pass"],
  isCurrent: true,
  completedAt: null,
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
  meetings: [
    { id: "meeting-new", bookTitle: "Parable of the Sower", readingTarget: "Finish", scheduledAt: 2000, createdAt: 2, status: "scheduled" },
    { id: "meeting-old", bookTitle: "Parable of the Sower", readingTarget: "Chapter 5", scheduledAt: 1000, createdAt: 1, status: "completed" },
  ],
};

const COMPLETED_BOOK = {
  ...ACTIVE_BOOK,
  id: "completed-book",
  title: "Kindred",
  tags: ["Classic"],
  isCurrent: false,
  completedAt: Date.UTC(2030, 0, 1),
  averageRating: 5,
  finishedCount: 1,
  meetings: [],
};

const UNKNOWN_COMPLETION_DATE_BOOK = {
  ...COMPLETED_BOOK,
  id: "unknown-date-book",
  title: "Legacy History",
  completedAt: null,
};

function renderLibrary(props = {}) {
  const defaults = {
    books: [ACTIVE_BOOK, COMPLETED_BOOK],
    selectedBookId: null,
    onSelectBook: vi.fn(),
    onBack: vi.fn(),
    onBooksChange: vi.fn(),
    onCompleteBook: vi.fn(),
    canAdminister: true,
    completingBook: false,
  };
  const merged = { ...defaults, ...props };
  return { ...render(<BookClubLibrary {...merged} />), props: merged };
}

describe("BookClubLibrary", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("lists the active book first with ratings and finished counts", async () => {
    const { props } = renderLibrary();
    const activeCard = screen.getByRole("button", { name: /Parable of the Sower/ });
    expect(activeCard).toHaveTextContent("Current");
    expect(activeCard).toHaveTextContent("4.0 ★");
    expect(activeCard).toHaveTextContent("0 people finished");
    expect(activeCard).toHaveTextContent("Speculative Fiction");
    expect(screen.getByRole("button", { name: /Kindred/ })).toBeInTheDocument();

    await userEvent.click(activeCard);
    expect(props.onSelectBook).toHaveBeenCalledWith("active-book");
  });

  it("includes custom tags in library search", async () => {
    renderLibrary();

    await userEvent.type(screen.getByRole("searchbox", { name: "Search books" }), "Bechdel");

    expect(screen.getByRole("button", { name: /Parable of the Sower/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kindred/ })).not.toBeInTheDocument();
  });

  it("allows an active-book legacy review to be updated", async () => {
    const updatedBook = {
      ...ACTIVE_BOOK,
      finishedCount: 1,
      viewerReview: { ...ACTIVE_BOOK.viewerReview, finished: true },
      reviews: [{ ...ACTIVE_BOOK.reviews[0], finished: true }],
    };
    reviewBookClubBook.mockResolvedValue({ books: [updatedBook, COMPLETED_BOOK] });
    const { props } = renderLibrary({ selectedBookId: ACTIVE_BOOK.id });
    const reviewSection = screen.getByRole("region", { name: "Your review" });
    const reviewToggle = within(reviewSection).getByRole("button", { name: /Your review/ });

    expect(screen.getAllByText("Finish status not recorded").length).toBeGreaterThan(0);
    expect(reviewToggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(reviewToggle);
    expect(within(reviewSection).getByRole("button", { name: "Update review" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Finished" }));
    await userEvent.type(screen.getByPlaceholderText("What stayed with you?"), "Still thinking about it.");
    await userEvent.click(screen.getByRole("button", { name: "Update review" }));

    expect(reviewBookClubBook).toHaveBeenCalledWith("andre", "active-book", {
      rating: 4,
      finished: true,
      note: "Still thinking about it.",
    });
    expect(props.onBooksChange).toHaveBeenCalledWith([updatedBook, COMPLETED_BOOK]);
    expect(await screen.findByRole("status")).toHaveTextContent("Review saved");
    expect(reviewToggle).toHaveAttribute("aria-expanded", "false");
    expect(within(reviewSection).getByRole("button", { name: "Update review" }).closest("[inert]")).toBeInTheDocument();

    await userEvent.click(reviewToggle);
    expect(within(reviewSection).getByRole("button", { name: "Update review" }).closest("[inert]")).not.toBeInTheDocument();
  });

  it("only offers book completion from a current book's detail page", () => {
    const { unmount } = renderLibrary({ selectedBookId: ACTIVE_BOOK.id });
    expect(screen.getByRole("button", { name: "Complete book" })).toBeInTheDocument();
    unmount();

    renderLibrary({ selectedBookId: COMPLETED_BOOK.id });
    expect(screen.queryByRole("button", { name: "Complete book" })).not.toBeInTheDocument();
  });

  it("labels historical books without a recorded completion date as completed", () => {
    renderLibrary({ books: [ACTIVE_BOOK, UNKNOWN_COMPLETION_DATE_BOOK] });
    expect(screen.getByRole("button", { name: /Legacy History/ })).toHaveTextContent("Completed");
    expect(screen.getByRole("button", { name: /Legacy History/ })).toHaveTextContent("Completion date unavailable");
  });

  it("keeps an existing review collapsed by default and available to edit", async () => {
    renderLibrary({ selectedBookId: ACTIVE_BOOK.id });
    const reviews = screen.getByRole("region", { name: "Your review" });
    const toggle = within(reviews).getByRole("button", { name: /Your review/ });
    const updateButton = within(reviews).getByRole("button", { name: "Update review" });
    const community = screen.getByRole("region", { name: "Community reviews" });
    const communityToggle = within(community).getByRole("button", {
      name: /Community reviews/,
    });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveTextContent(/[+−]/);
    expect(communityToggle).toHaveAttribute("aria-expanded", "false");
    expect(communityToggle).not.toHaveTextContent(/[+−]/);
    expect(updateButton.closest("[inert]")).toBeInTheDocument();
    expect(within(community).getByText("Andre").closest("[inert]"))
      .toBeInTheDocument();
    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(updateButton.closest("[inert]")).not.toBeInTheDocument();
    await userEvent.click(communityToggle);
    expect(communityToggle).toHaveAttribute("aria-expanded", "true");
    expect(within(community).getByText("Andre").closest("[inert]"))
      .not.toBeInTheDocument();
  });

  it("opens the review form by default for a book the member has not reviewed", () => {
    renderLibrary({
      selectedBookId: ACTIVE_BOOK.id,
      books: [{ ...ACTIVE_BOOK, viewerReview: null, reviews: [], reviewCount: 0 }],
    });

    const reviews = screen.getByRole("region", { name: "Your review" });
    expect(within(reviews).getByRole("button", { name: /Your review/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(reviews).getByRole("button", { name: "Save review" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Community reviews" }))
      .getByRole("button", { name: /Community reviews/ }))
      .toHaveAttribute("aria-expanded", "false");
  });

  it("returns to the list from a stale linked book", async () => {
    const { props } = renderLibrary({ selectedBookId: "missing-book" });
    expect(screen.getByRole("heading", { name: "Book unavailable" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View all books" }));
    expect(props.onBack).toHaveBeenCalled();
  });
});

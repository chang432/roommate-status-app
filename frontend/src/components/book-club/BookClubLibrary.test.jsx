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
vi.mock("./BookClubForum.jsx", () => ({
  default: ({ meeting, focusThreadId }) => (
    <div data-testid={`forum-${meeting.id}`} data-focus-thread={focusThreadId || ""}>
      Forum for {meeting.readingTarget}
    </div>
  ),
}));

const ACTIVE_BOOK = {
  id: "active-book",
  title: "Parable of the Sower",
  author: "Octavia E. Butler",
  bookOwnerName: "Kayla",
  status: "active",
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
  status: "completed",
  isCurrent: false,
  completedAt: Date.UTC(2030, 0, 1),
  averageRating: 5,
  finishedCount: 1,
  meetings: [],
};

function renderLibrary(props = {}) {
  const defaults = {
    books: [ACTIVE_BOOK, COMPLETED_BOOK],
    selectedBookId: null,
    onSelectBook: vi.fn(),
    onBack: vi.fn(),
    onBooksChange: vi.fn(),
    canAdminister: true,
    focusMeetingId: null,
    focusThreadId: null,
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
    expect(screen.getByRole("button", { name: /Kindred/ })).toBeInTheDocument();

    await userEvent.click(activeCard);
    expect(props.onSelectBook).toHaveBeenCalledWith("active-book");
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

    expect(screen.getAllByText("Finish status not recorded").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Update review" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Finished" }));
    await userEvent.type(screen.getByPlaceholderText("What stayed with you?"), "Still thinking about it.");
    await userEvent.click(screen.getByRole("button", { name: "Update review" }));

    expect(reviewBookClubBook).toHaveBeenCalledWith("andre", "active-book", {
      rating: 4,
      finished: true,
      note: "Still thinking about it.",
    });
    expect(props.onBooksChange).toHaveBeenCalledWith([updatedBook, COMPLETED_BOOK]);
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });

  it("shows every meeting discussion newest first and focuses the linked thread", async () => {
    renderLibrary({
      selectedBookId: ACTIVE_BOOK.id,
      focusMeetingId: "meeting-old",
      focusThreadId: "topic-1",
    });

    const discussions = screen.getByRole("region", { name: "Discussions" });
    expect(screen.getByTestId("forum-meeting-old")).toHaveAttribute("data-focus-thread", "topic-1");
    expect(screen.queryByTestId("forum-meeting-new")).not.toBeInTheDocument();
    await userEvent.click(within(discussions).getAllByRole("button")[1]);
    expect(screen.getByTestId("forum-meeting-new")).toHaveAttribute("data-focus-thread", "");
  });

  it("returns to the list from a stale linked book", async () => {
    const { props } = renderLibrary({ selectedBookId: "missing-book" });
    expect(screen.getByRole("heading", { name: "Book unavailable" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View all books" }));
    expect(props.onBack).toHaveBeenCalled();
  });
});

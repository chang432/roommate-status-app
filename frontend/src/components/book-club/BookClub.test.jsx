import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import BookClub from "./BookClub.jsx";
import { getBookClub, getCompletedBookClubBooks, notifyBookClubMeeting, startNextBook } from "../../api/bookClub.js";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));

vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getBookClub: vi.fn(),
  getCompletedBookClubBooks: vi.fn(),
  notifyBookClubMeeting: vi.fn(),
  startNextBook: vi.fn(),
  configureBookClub: vi.fn(),
  setBookClubResponse: vi.fn(),
}));

afterEach(() => cleanup());

describe("BookClub", () => {
  it("renders an empty state while a group has no configured club", async () => {
    getBookClub.mockResolvedValue({ summary: null });
    render(<BookClub roommates={[]} groupId="yorkshire" />);

    expect(screen.getByRole("region", { name: "Book Club" })).toHaveTextContent(
      "Book Club",
    );
    await waitFor(() => expect(screen.getByText(/has not configured/i)).toBeInTheDocument());
  });

  it("places the chapter goal above the next meeting and opens the book history", async () => {
    getBookClub.mockResolvedValue({
      summary: {
        activeBook: { id: "current", title: "Parable of the Sower", author: "Octavia E. Butler" },
        configuration: { snackRotationUserIds: ["andre", "kayla"], snackRotationCursor: 0 },
        nextSession: {
          id: "session#future",
          scheduledAt: Date.UTC(2026, 7, 5, 23, 30),
          readingTarget: "Read through Chapter 6",
          snackDutyName: "Kayla",
          responses: [],
        },
      },
    });
    getCompletedBookClubBooks.mockResolvedValue({
      books: [{ id: "older", title: "Kindred", author: "Octavia E. Butler", recommendedByName: "Kayla" }],
    });

    render(<BookClub roommates={[{ id: "andre", name: "Andre" }, { id: "kayla", name: "Kayla" }]} groupId="book-club" />);

    await waitFor(() => expect(screen.getByText(/Book:/)).toBeInTheDocument());
    const summaryRows = screen.getAllByText(/Book:|Chapter goal:|Next meeting:|Snack duty:/).map((element) => element.textContent);
    expect(summaryRows).toEqual(["Book:", "Chapter goal:", "Next meeting:", "Snack duty:"]);
    expect(screen.getByText(/Snack duty:/)).toBeInTheDocument();
    expect(screen.queryByText("Book Club")).toBeNull();
    expect(screen.queryByText("Eastern time")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Parable of the Sower/i }));
    expect(await screen.findByRole("dialog", { name: "Book history" })).toHaveTextContent("Current book");
    expect(screen.getByRole("dialog", { name: "Book history" })).toHaveTextContent("Recommended by Kayla");
  });

  it("shows the current snack-duty member followed by the upcoming rotation", async () => {
    getBookClub.mockResolvedValue({
      summary: {
        activeBook: { id: "current", title: "A Book", author: "An Author" },
        configuration: { snackRotationUserIds: ["andre", "kayla", "sheryl"], snackRotationCursor: 1 },
        nextSession: {
          id: "session#future",
          scheduledAt: Date.UTC(2026, 7, 5, 23, 30),
          readingTarget: "Chapter 1",
          snackDutyName: "Kayla",
          responses: [],
        },
      },
    });

    render(<BookClub roommates={[
      { id: "andre", name: "Andre" }, { id: "kayla", name: "Kayla" }, { id: "sheryl", name: "Sheryl" },
    ]} groupId="book-club" />);

    await userEvent.click(await screen.findByRole("button", { name: "Kayla" }));
    const dialog = screen.getByRole("dialog", { name: "Snack-duty rotation" });
    expect(dialog).toHaveTextContent("KaylaCurrent snack duty");
    expect(dialog).toHaveTextContent("SherylComing up #1");
    expect(dialog).toHaveTextContent("AndreComing up #2");
  });

  it("lets any member notify the group about the upcoming meeting", async () => {
    getBookClub.mockResolvedValue({
      summary: {
        activeBook: { title: "A Book", author: "An Author" },
        nextSession: {
          id: "session#future",
          scheduledAt: Date.UTC(2026, 7, 5, 23, 30),
          readingTarget: "Chapter 1",
          snackDutyName: "Andre",
          responses: [],
        },
      },
    });
    notifyBookClubMeeting.mockResolvedValue({ sent: 1, pruned: 0, failed: 0 });

    render(<BookClub roommates={[{ id: "andre", name: "Andre", role: "member" }]} groupId="book-club" />);

    await userEvent.click(await screen.findByRole("button", { name: "Notify everyone about next meeting" }));
    expect(notifyBookClubMeeting).toHaveBeenCalledWith("andre", "session#future");
    expect(screen.queryByText(/simulate meeting time/i)).toBeNull();
  });

  it("lets an admin start a distinct next book with a new chapter goal", async () => {
    const nextSummary = {
      activeBook: { id: "next", title: "The Dispossessed", author: "Ursula K. Le Guin" },
      configuration: { snackRotationUserIds: ["andre", "kayla"], snackRotationCursor: 0 },
      nextSession: {
        id: "session#future",
        scheduledAt: Date.UTC(2026, 7, 5, 23, 30),
        readingTarget: "Read through Chapter 3",
        snackDutyName: "Andre",
        responses: [],
      },
    };
    getBookClub.mockResolvedValue({
      summary: {
        activeBook: { id: "current", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" },
        configuration: { snackRotationUserIds: ["andre", "kayla"], snackRotationCursor: 0 },
        nextSession: {
          id: "session#future",
          scheduledAt: Date.UTC(2026, 7, 5, 23, 30),
          readingTarget: "Read through Chapter 8",
          snackDutyName: "Andre",
          responses: [],
        },
      },
    });
    startNextBook.mockResolvedValue({ summary: nextSummary });

    render(<BookClub roommates={[
      { id: "andre", name: "Andre", role: "admin" }, { id: "kayla", name: "Kayla", role: "member" },
    ]} groupId="book-club" />);

    await userEvent.click(await screen.findByRole("button", { name: "Start next book" }));
    await userEvent.type(screen.getByLabelText("Book title"), "The Dispossessed");
    await userEvent.type(screen.getByLabelText("Author"), "Ursula K. Le Guin");
    await userEvent.type(screen.getByLabelText("Chapter goal"), "Read through Chapter 3");
    await userEvent.click(screen.getByRole("button", { name: "Start next book" }));

    expect(startNextBook).toHaveBeenCalledWith("andre", {
      title: "The Dispossessed", author: "Ursula K. Le Guin", readingTarget: "Read through Chapter 3",
    });
    expect(await screen.findByRole("button", { name: /The Dispossessed/i })).toBeInTheDocument();
  });

  it("defaults unanswered attendance to not attending without a not-responded option", async () => {
    getBookClub.mockReset();
    getBookClub.mockResolvedValue({
      summary: {
        activeBook: { title: "A Book", author: "An Author" },
        nextSession: {
          id: "session#future",
          scheduledAt: Date.UTC(2026, 7, 5, 23, 30),
          readingTarget: "Chapter 1",
          snackDutyName: "Andre",
          responses: [
            { userId: "andre", userName: "Andre", attendanceStatus: "not_attending", chaptersReadThrough: 0 },
            { userId: "kayla", userName: "Kayla", attendanceStatus: "not_attending", chaptersReadThrough: 0 },
          ],
        },
      },
    });

    render(<BookClub roommates={[{ id: "andre", name: "Andre" }, { id: "kayla", name: "Kayla" }]} groupId="book-club" />);

    const attendance = await screen.findByRole("combobox", { name: "Your attendance" });
    expect(attendance).toHaveValue("not_attending");
    expect(screen.queryByRole("option", { name: "Not responded" })).toBeNull();
    expect(screen.getByText("not attending · through chapter 0")).toBeInTheDocument();
  });

  it("reloads its summary when the page refreshes", async () => {
    getBookClub.mockReset();
    getBookClub
      .mockResolvedValueOnce({ summary: null })
      .mockResolvedValueOnce({
        summary: {
          activeBook: { title: "Fresh Book", author: "An Author" },
          nextSession: {
            id: "session#future",
            scheduledAt: Date.UTC(2026, 7, 5, 23, 30),
            readingTarget: "Chapter 1",
            snackDutyName: "Andre",
            responses: [],
          },
        },
      });
    const { rerender } = render(
      <BookClub roommates={[{ id: "andre", name: "Andre" }]} groupId="book-club" refreshToken={0} />,
    );

    await waitFor(() => expect(screen.getByText(/has not configured/i)).toBeInTheDocument());
    rerender(<BookClub roommates={[{ id: "andre", name: "Andre" }]} groupId="book-club" refreshToken={1} />);

    expect(await screen.findByRole("button", { name: /Fresh Book/i })).toBeInTheDocument();
  });
});

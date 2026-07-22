import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BookClub from "./BookClub.jsx";
import { getBookClub, notifyBookClubMeeting } from "../../api/client.js";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));

vi.mock("../../api/client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getBookClub: vi.fn(),
  notifyBookClubMeeting: vi.fn(),
  configureBookClub: vi.fn(),
  setBookClubResponse: vi.fn(),
}));

describe("BookClub", () => {
  it("renders an empty state while a group has no configured club", async () => {
    getBookClub.mockResolvedValue({ summary: null });
    render(<BookClub roommates={[]} groupId="yorkshire" />);

    expect(screen.getByRole("region", { name: "Book Club" })).toHaveTextContent(
      "Book Club",
    );
    await waitFor(() => expect(screen.getByText(/has not configured/i)).toBeInTheDocument());
  });

  it("uses the requested four-line meeting summary without a title banner", async () => {
    getBookClub.mockResolvedValue({
      summary: {
        activeBook: { title: "Parable of the Sower", author: "Octavia E. Butler" },
        nextSession: {
          id: "session#future",
          scheduledAt: Date.UTC(2026, 7, 5, 23, 30),
          readingTarget: "Read through Chapter 6",
          snackDutyName: "Kayla",
          responses: [],
        },
      },
    });

    render(<BookClub roommates={[]} groupId="book-club" />);

    await waitFor(() => expect(screen.getByText(/Book:/)).toBeInTheDocument());
    expect(screen.getByText(/Next meeting:/)).toBeInTheDocument();
    expect(screen.getByText(/Chapter goal:/)).toBeInTheDocument();
    expect(screen.getByText(/Snack duty:/)).toBeInTheDocument();
    expect(screen.queryByText("Book Club")).toBeNull();
    expect(screen.queryByText("Eastern time")).toBeNull();
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
});

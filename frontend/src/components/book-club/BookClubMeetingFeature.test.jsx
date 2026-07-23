import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookClubMeetingFeature from "./BookClubMeetingFeature.jsx";
import { getBookClubMeeting } from "../../api/bookClub.js";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getBookClubMeeting: vi.fn(),
}));

const MEETING = {
  id: "meeting#1",
  bookId: "book-1",
  bookTitle: "The Left Hand of Darkness",
  bookAuthor: "Ursula K. Le Guin",
  readingTarget: "Chapter 8",
  bookOwnerName: "Kayla",
  snackOwnerName: "Andre",
  scheduledAt: Date.UTC(2030, 7, 7, 23, 30),
  status: "scheduled",
  responses: [],
};

describe("BookClubMeetingFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBookClubMeeting.mockResolvedValue({ meeting: MEETING });
  });
  afterEach(() => cleanup());

  it("places the existing admin edit action beside the open-meeting actions", async () => {
    const onEdit = vi.fn();
    render(
      <BookClubMeetingFeature
        meetings={[MEETING]}
        moduleTag={<span>Books</span>}
        editTrigger={{ enabled: true, onEdit, headerProps: {}, keyboardProps: {} }}
        canAdminister
        onChanged={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /The Left Hand of Darkness/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Send reminder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete meeting" })).toBeInTheDocument();
  });

  it("does not show Edit when the feed marks the meeting non-editable", async () => {
    render(
      <BookClubMeetingFeature
        meetings={[MEETING]}
        moduleTag={<span>Books</span>}
        editTrigger={{ enabled: false, headerProps: {}, keyboardProps: {} }}
        canAdminister={false}
        onChanged={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /The Left Hand of Darkness/ }));
    expect(await screen.findByRole("button", { name: "Send reminder" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});

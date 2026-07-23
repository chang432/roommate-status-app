import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookClubMeetingFeature from "./BookClubMeetingFeature.jsx";
import {
  createBookClubForumEntry,
  getBookClubForum,
  getBookClubMeeting,
} from "../../api/bookClub.js";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  createBookClubForumEntry: vi.fn(),
  getBookClubForum: vi.fn(),
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
    getBookClubForum.mockResolvedValue({
      forum: { meetingId: MEETING.id, locked: false, threads: [] },
    });
  });
  afterEach(() => cleanup());

  it("keeps details mounted for the shared expand and collapse animation", async () => {
    render(
      <BookClubMeetingFeature
        meetings={[MEETING]}
        roommates={[]}
        canAdminister={false}
        onChanged={vi.fn()}
      />,
    );

    const header = screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("[inert]")).toBeInTheDocument();
    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector("[inert]")).not.toBeInTheDocument();
    expect(getBookClubMeeting).toHaveBeenCalledWith("andre", "meeting#1");
    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("[inert]")).toBeInTheDocument();
  });

  it("places meeting administration actions with the meeting details", async () => {
    const onEdit = vi.fn();
    render(
      <BookClubMeetingFeature
        meetings={[MEETING]}
        roommates={[]}
        onEdit={onEdit}
        canAdminister
        onChanged={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    }));
    const editButton = await screen.findByRole("button", { name: "Edit meeting" });
    const reminderButton = screen.getByRole("button", { name: "Send reminder" });
    const completeButton = screen.getByRole("button", { name: "Complete meeting" });
    expect(editButton.parentElement).toContainElement(reminderButton);
    expect(editButton.parentElement).toContainElement(completeButton);
    await userEvent.click(editButton);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("does not show Edit when the feed marks the meeting non-editable", async () => {
    render(
      <BookClubMeetingFeature
        meetings={[MEETING]}
        roommates={[]}
        canAdminister={false}
        onChanged={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    }));
    expect(await screen.findByRole("button", { name: "Send reminder" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit meeting" })).not.toBeInTheDocument();
  });

  it("opens the forum from a deep link and can create a topic", async () => {
    const createdForum = {
      meetingId: MEETING.id,
      locked: false,
      threads: [{
        id: "forum#1",
        title: "Favorite passage",
        body: "Which scene stayed with you?",
        authorId: "andre",
        authorName: "Andre",
        createdAt: 1,
        updatedAt: 1,
        lastActivityAt: 1,
        replies: [],
      }],
    };
    createBookClubForumEntry.mockResolvedValue({ forum: createdForum });
    render(
      <BookClubMeetingFeature
        meetings={[MEETING]}
        roommates={[]}
        focusMeetingId="meeting#1"
        canAdminister={false}
        onChanged={vi.fn()}
      />,
    );

    expect(await screen.findByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: true,
    })).toBeInTheDocument();
    expect(getBookClubMeeting).toHaveBeenCalledWith("andre", "meeting#1");
    expect(getBookClubForum).toHaveBeenCalledWith("andre", "meeting#1");

    await userEvent.type(screen.getByLabelText("New topic title"), "Favorite passage");
    await userEvent.type(screen.getByLabelText("New topic post"), "Which scene stayed with you?");
    await userEvent.click(screen.getByRole("button", { name: "Post topic" }));
    expect(createBookClubForumEntry).toHaveBeenCalledWith("andre", "meeting#1", {
      title: "Favorite passage",
      body: "Which scene stayed with you?",
    });
    expect(await screen.findByRole("heading", { name: "Favorite passage" })).toBeInTheDocument();
  });

  it("keeps a completed meeting forum visible but read-only", async () => {
    getBookClubForum.mockResolvedValue({
      forum: {
        meetingId: MEETING.id,
        locked: true,
        threads: [{
          id: "forum#1",
          title: "Favorite passage",
          body: "Which scene stayed with you?",
          authorId: "andre",
          authorName: "Andre",
          createdAt: 1,
          updatedAt: 1,
          lastActivityAt: 1,
          replies: [],
        }],
      },
    });
    render(
      <BookClubMeetingFeature
        meetings={[{ ...MEETING, status: "completed" }]}
        focusMeetingId="meeting#1"
        canAdminister
        onChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText(
      "This forum closed when the meeting was completed.",
    )).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Favorite passage" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Start a topic" })).not.toBeInTheDocument();
  });
});

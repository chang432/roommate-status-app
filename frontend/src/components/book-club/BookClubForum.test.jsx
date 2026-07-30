import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookClubForum from "./BookClubForum.jsx";
import {
  createBookClubForumEntry,
  deleteBookClubForumEntry,
  getBookClubForum,
} from "../../api/bookClub.js";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  createBookClubForumEntry: vi.fn(),
  deleteBookClubForumEntry: vi.fn(),
  getBookClubForum: vi.fn(),
}));

const MEETING = {
  id: "meeting#1",
  bookTitle: "The Left Hand of Darkness",
  status: "scheduled",
};

describe("BookClubForum", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBookClubForum.mockResolvedValue({
      forum: { meetingId: MEETING.id, locked: false, threads: [] },
    });
  });
  afterEach(() => cleanup());

  it("creates topics in an open meeting discussion", async () => {
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
    render(<BookClubForum meeting={MEETING} canAdminister={false} />);

    await userEvent.click(await screen.findByRole("button", { name: "New topic" }));
    await userEvent.type(screen.getByLabelText("New topic title"), "Favorite passage");
    await userEvent.type(screen.getByLabelText("New topic post"), "Which scene stayed with you?");
    await userEvent.click(screen.getByRole("button", { name: "Post topic" }));
    expect(createBookClubForumEntry).toHaveBeenCalledWith("andre", "meeting#1", {
      title: "Favorite passage",
      body: "Which scene stayed with you?",
    });
    expect(await screen.findByRole("heading", { name: "Favorite passage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New topic" })).toBeInTheDocument();
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
    render(<BookClubForum meeting={{ ...MEETING, status: "completed" }} canAdminister />);

    expect(await screen.findByText(
      "This forum closed when the meeting was completed.",
    )).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Favorite passage" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Start a topic" })).not.toBeInTheDocument();
  });

  it("confirms before permanently removing a topic", async () => {
    const forum = {
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
    getBookClubForum.mockResolvedValue({ forum });
    deleteBookClubForumEntry.mockResolvedValue({
      forum: { ...forum, threads: [] },
    });
    render(<BookClubForum meeting={MEETING} canAdminister={false} />);

    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(deleteBookClubForumEntry).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Remove topic" }));

    expect(deleteBookClubForumEntry).toHaveBeenCalledWith(
      "andre",
      "meeting#1",
      "forum#1",
    );
  });
});

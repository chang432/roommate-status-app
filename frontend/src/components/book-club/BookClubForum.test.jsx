import { cleanup, render, screen, within } from "@testing-library/react";
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

  it("sends messages in an open meeting discussion", async () => {
    const createdForum = {
      meetingId: MEETING.id,
      locked: false,
      threads: [{
        id: "forum#1",
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

    await userEvent.type(await screen.findByLabelText("New message"), "Which scene stayed with you?");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(createBookClubForumEntry).toHaveBeenCalledWith("andre", "meeting#1", {
      body: "Which scene stayed with you?",
    });
    expect(await screen.findByText("Which scene stayed with you?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("keeps a completed meeting discussion visible but read-only", async () => {
    getBookClubForum.mockResolvedValue({
      forum: {
        meetingId: MEETING.id,
        locked: true,
        threads: [{
          id: "forum#1",
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
      "This discussion closed when the meeting was completed.",
    )).toBeInTheDocument();
    expect(screen.getByText("Which scene stayed with you?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /More actions/ })).not.toBeInTheDocument();
  });

  it("confirms before permanently removing a topic", async () => {
    const forum = {
      meetingId: MEETING.id,
      locked: false,
      threads: [{
        id: "forum#1",
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

    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", {
      name: "More actions for Andre's message",
    }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect(deleteBookClubForumEntry).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Remove message" }));

    expect(deleteBookClubForumEntry).toHaveBeenCalledWith(
      "andre",
      "meeting#1",
      "forum#1",
    );
  });

  it("shows only permitted actions and supports keyboard dismissal", async () => {
    getBookClubForum.mockResolvedValue({
      forum: {
        meetingId: MEETING.id,
        locked: false,
        threads: [{
          id: "forum#1",
          body: "Root message",
          authorId: "andre",
          authorName: "Andre",
          createdAt: 1,
          updatedAt: 1,
          lastActivityAt: 2,
          replies: [{
            id: "forum#2",
            parentPostId: "forum#1",
            body: "A reply",
            authorId: "kayla",
            authorName: "Kayla",
            createdAt: 2,
            updatedAt: 2,
          }],
        }],
      },
    });
    render(<BookClubForum meeting={MEETING} canAdminister />);

    const ownActions = await screen.findByRole("button", {
      name: "More actions for Andre's message",
    });
    await userEvent.click(ownActions);
    const ownMenu = screen.getByRole("menu", { name: "Actions for Andre's message" });
    expect(within(ownMenu).getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(within(ownMenu).getByRole("menuitem", { name: "Remove" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Actions for Andre's message" }))
      .not.toBeInTheDocument();
    expect(ownActions).toHaveFocus();

    await userEvent.click(screen.getByRole("button", {
      name: "More actions for Kayla's reply",
    }));
    const adminMenu = screen.getByRole("menu", { name: "Actions for Kayla's reply" });
    expect(within(adminMenu).queryByRole("menuitem", { name: "Edit" }))
      .not.toBeInTheDocument();
    expect(within(adminMenu).getByRole("menuitem", { name: "Remove" })).toBeInTheDocument();
  });

  it("collapses roots and replies independently", async () => {
    getBookClubForum.mockResolvedValue({
      forum: {
        meetingId: MEETING.id,
        locked: false,
        threads: [{
          id: "forum#1",
          body: "Root message",
          authorId: "andre",
          authorName: "Andre",
          createdAt: 1,
          updatedAt: 1,
          lastActivityAt: 1,
          replies: [{
            id: "forum#2",
            parentPostId: "forum#1",
            body: "A reply",
            authorId: "kayla",
            authorName: "Kayla",
            createdAt: 2,
            updatedAt: 2,
          }],
        }],
      },
    });
    render(<BookClubForum meeting={MEETING} canAdminister={false} />);

    const rootToggle = await screen.findByRole("button", { name: /Andre/, expanded: true });
    const replyToggle = screen.getByRole("button", { name: /Kayla/, expanded: true });
    expect(rootToggle).toHaveAttribute("aria-expanded", "true");
    expect(replyToggle).toHaveAttribute("aria-expanded", "true");
    expect(within(rootToggle).getByText("−")).toBeVisible();
    expect(within(replyToggle).getByText("−")).toBeVisible();

    await userEvent.click(replyToggle);
    expect(replyToggle).toHaveAttribute("aria-expanded", "false");
    expect(within(replyToggle).getByText("+")).toBeVisible();
    expect(screen.getByText("A reply")).not.toBeVisible();

    await userEvent.click(rootToggle);
    expect(rootToggle).toHaveAttribute("aria-expanded", "false");
    expect(within(rootToggle).getByText("+")).toBeVisible();
    expect(screen.queryByText("Root message")).not.toBeVisible();
    expect(screen.queryByRole("button", { name: /Kayla/ })).not.toBeInTheDocument();
  });
});

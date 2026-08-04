import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { archiveForum, commentOnForum } from "../../api/forums.js";
import { ModuleFocusProvider } from "../../context/ModuleFocusContext.jsx";
import ForumFeature from "./ForumFeature.jsx";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/forums.js", () => ({
  archiveForum: vi.fn(),
  commentOnForum: vi.fn(),
  deleteForum: vi.fn(),
  restoreForum: vi.fn(),
  setForumCommentLiked: vi.fn(),
}));

const FORUM = {
  id: "book-forum#1",
  title: "Memory and survival",
  bookId: "book-1",
  bookTitle: "Kindred",
  bookAuthor: "Octavia E. Butler",
  createdById: "andre",
  createdBy: "Andre",
  createdAt: Date.now(),
  comments: [],
  isArchived: false,
};

describe("ForumFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commentOnForum.mockResolvedValue([]);
    archiveForum.mockResolvedValue([]);
  });
  afterEach(() => cleanup());

  it("reveals the linked book above comments without collapsing the forum", async () => {
    const onChanged = vi.fn();
    render(
      <MemoryRouter>
        <ModuleFocusProvider intent={null}>
          <ForumFeature
            forum={FORUM}
            roommates={[{ id: "andre", name: "Andre" }]}
            onForumsChange={onChanged}
            moduleTag={<span>Forums</span>}
            onEdit={vi.fn()}
          />
        </ModuleFocusProvider>
      </MemoryRouter>,
    );

    const bookLink = screen.getByRole("link", {
      name: "View Kindred in the Book Club library",
    });
    const header = screen.getByRole("button", {
      name: "Open forum Memory and survival",
    });
    const creatorMeta = screen.getByText(/Andre ·/);
    expect(bookLink).toHaveAttribute("href", "/?book=book-1");
    expect(bookLink.closest("[inert]")).not.toBeNull();
    expect(header).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(header);
    const closeHeader = screen.getByRole("button", {
      name: "Close forum Memory and survival",
    });
    expect(closeHeader).toHaveAttribute("aria-expanded", "true");
    expect(bookLink.closest("[inert]")).toBeNull();
    expect(bookLink.parentElement.nextElementSibling).toHaveTextContent("Comments");
    await userEvent.click(bookLink);
    expect(closeHeader).toHaveAttribute("aria-expanded", "true");
    expect(creatorMeta).toBeInTheDocument();
    expect(screen.queryByText("Discussing")).not.toBeInTheDocument();
    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/Add a comment/), "The ending changed it.");
    await userEvent.click(screen.getByRole("button", { name: "Send comment" }));
    expect(commentOnForum).toHaveBeenCalledWith(
      "book-forum#1",
      "andre",
      "The ending changed it.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(archiveForum).toHaveBeenCalledWith("book-forum#1", "andre");
  });
});

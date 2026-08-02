import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBookClubBooks } from "../../api/bookClub.js";
import { createForum } from "../../api/forums.js";
import ForumForm from "./ForumForm.jsx";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/bookClub.js", () => ({ getBookClubBooks: vi.fn() }));
vi.mock("../../api/forums.js", () => ({
  createForum: vi.fn(),
  updateForum: vi.fn(),
}));

describe("ForumForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBookClubBooks.mockResolvedValue({
      books: [
        { id: "book-1", title: "Kindred", author: "Octavia E. Butler" },
        { id: "book-2", title: "Beloved", author: "Toni Morrison" },
      ],
    });
    createForum.mockResolvedValue([]);
  });
  afterEach(() => cleanup());

  it("requires a title and creates a forum tagged to a library book", async () => {
    const onChanged = vi.fn();
    const onSaved = vi.fn();
    render(<ForumForm onChanged={onChanged} onSaved={onSaved} onCancel={vi.fn()} />);

    await screen.findByRole("option", { name: "Kindred — Octavia E. Butler" });
    const submit = screen.getByRole("button", { name: "Create forum" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Forum title"), "Memory and survival");
    await userEvent.selectOptions(screen.getByLabelText("Book"), "book-2");
    await userEvent.click(submit);

    expect(createForum).toHaveBeenCalledWith("Memory and survival", "book-2", "andre");
    expect(onChanged).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });
});

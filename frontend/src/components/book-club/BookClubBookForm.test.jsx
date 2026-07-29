import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addBookClubBook, updateBookClubBook } from "../../api/bookClub.js";
import BookClubBookForm from "./BookClubBookForm.jsx";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre" } }),
}));
vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  addBookClubBook: vi.fn(),
  updateBookClubBook: vi.fn(),
}));

const ROOMMATES = [
  { id: "andre", name: "Andre" },
  { id: "kayla", name: "Kayla" },
];

describe("BookClubBookForm", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("adds a catalog book without selecting it as current", async () => {
    const response = {
      book: { id: "book-1", title: "Kindred" },
      books: [{ id: "book-1", title: "Kindred", isCurrent: false }],
    };
    addBookClubBook.mockResolvedValue(response);
    const onSaved = vi.fn();
    render(<BookClubBookForm roommates={ROOMMATES} onSaved={onSaved} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByRole("textbox", { name: "Book title" }), "Kindred");
    await userEvent.type(screen.getByRole("textbox", { name: "Author" }), "Octavia E. Butler");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Book owner" }), "kayla");
    await userEvent.click(screen.getByRole("button", { name: "Add book" }));

    expect(addBookClubBook).toHaveBeenCalledWith("andre", {
      title: "Kindred", author: "Octavia E. Butler", bookOwnerId: "kayla",
    });
    expect(onSaved).toHaveBeenCalledWith(response);
  });

  it("updates the canonical metadata for an existing book", async () => {
    updateBookClubBook.mockResolvedValue({ book: { id: "book-1" }, books: [] });
    render(<BookClubBookForm book={{
      id: "book-1", title: "Kindered", author: "Octavia Butler", bookOwnerId: "andre",
    }} roommates={ROOMMATES} onSaved={vi.fn()} onCancel={vi.fn()} />);

    const title = screen.getByRole("textbox", { name: "Book title" });
    await userEvent.clear(title);
    await userEvent.type(title, "Kindred");
    await userEvent.click(screen.getByRole("button", { name: "Save book" }));
    expect(updateBookClubBook).toHaveBeenCalledWith(
      "andre", "book-1", expect.objectContaining({ title: "Kindred" }),
    );
  });
});

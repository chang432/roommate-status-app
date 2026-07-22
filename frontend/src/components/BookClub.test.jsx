import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BookClub from "./BookClub.jsx";
import { getBookClub } from "../api/client.js";

vi.mock("../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));

vi.mock("../api/client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getBookClub: vi.fn(),
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
});

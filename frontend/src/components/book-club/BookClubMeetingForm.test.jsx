import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookClubMeetingForm from "./BookClubMeetingForm.jsx";
import { createBookClubMeeting, getBookClub } from "../../api/bookClub.js";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre" } }),
}));
vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getBookClub: vi.fn(),
  createBookClubMeeting: vi.fn(),
}));
vi.mock("../../api/feed.js", () => ({ updateModule: vi.fn() }));

const ROOMMATES = [
  { id: "andre", name: "Andre" },
  { id: "kayla", name: "Kayla" },
];

describe("BookClubMeetingForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBookClub.mockResolvedValue({
      summary: {
        configuration: {
          suggestedMeetingAt: Date.UTC(2030, 7, 7, 23, 30),
          bookOwnerOrderUserIds: ["kayla", "andre"],
          snackOwnerOrderUserIds: ["andre", "kayla"],
        },
        activeBook: { title: "A Book", author: "An Author" },
      },
    });
    createBookClubMeeting.mockResolvedValue({ meeting: { id: "meeting#1" } });
  });
  afterEach(() => cleanup());

  it("defaults both fields to their prior owners and loops when changed", async () => {
    render(<BookClubMeetingForm roommates={ROOMMATES} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByText("Kayla")).toBeInTheDocument();
    expect(screen.getByText("Andre")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next Book owner" }));
    expect(screen.getAllByText("Andre").length).toBeGreaterThan(1);
    await userEvent.type(screen.getByLabelText("Reading target"), "Chapter 2");
    await userEvent.click(screen.getByRole("button", { name: "Create meeting" }));

    expect(createBookClubMeeting).toHaveBeenCalledWith(
      "andre",
      expect.objectContaining({ bookOwnerId: "andre", snackOwnerId: "andre" }),
    );
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookClubMeetingFeature from "./BookClubMeetingFeature.jsx";
import { getBookClubMeeting } from "../../api/bookClub.js";
import { ModuleFocusProvider } from "../../context/ModuleFocusContext.jsx";

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

  it("keeps details mounted for the shared expand and collapse animation", async () => {
    render(
      <BookClubMeetingFeature
        meetings={[MEETING]}
        moduleTag={<span>Books</span>}
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

  it("places the existing admin edit action beside the open-meeting actions", async () => {
    const onEdit = vi.fn();
    render(
      <BookClubMeetingFeature
        meetings={[MEETING]}
        moduleTag={<span>Books</span>}
        onEdit={onEdit}
        canAdminister
        onChanged={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    }));
    const editButton = await screen.findByRole("button", { name: "Edit" });
    const reminderButton = screen.getByRole("button", { name: "Send reminder" });
    const completeButton = screen.getByRole("button", { name: "Complete meeting" });
    expect(editButton.parentElement).toHaveClass("ui-moduleActionRow");
    expect(editButton).toHaveClass("ui-pillSecondary", "ui-moduleActionButton");
    expect(reminderButton).toHaveClass("ui-pillSecondary", "ui-moduleActionButton");
    expect(completeButton).toHaveClass("ui-pillSecondary", "ui-moduleActionButton");
    await userEvent.click(editButton);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("does not show Edit when the feed marks the meeting non-editable", async () => {
    render(
      <BookClubMeetingFeature
        meetings={[MEETING]}
        moduleTag={<span>Books</span>}
        canAdminister={false}
        onChanged={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    }));
    expect(await screen.findByRole("button", { name: "Send reminder" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("loads full meeting details when a deep link expands the module", async () => {
    render(
      <ModuleFocusProvider intent={{ itemId: "meeting#1", token: "focus-1" }}>
        <BookClubMeetingFeature
          meetings={[MEETING]}
          moduleTag={<span>Books</span>}
          canAdminister={false}
          onChanged={vi.fn()}
        />
      </ModuleFocusProvider>,
    );

    expect(await screen.findByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: true,
    })).toBeInTheDocument();
    expect(getBookClubMeeting).toHaveBeenCalledWith("andre", "meeting#1");
  });
});

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import BookClubMeetingFeature from "./BookClubMeetingFeature.jsx";
import { getBookClubMeeting, setBookClubResponse } from "../../api/bookClub.js";
import { ModuleFocusProvider } from "../../context/ModuleFocusContext.jsx";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getBookClubMeeting: vi.fn(),
  setBookClubResponse: vi.fn(),
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
  responses: [{
    userId: "andre",
    userName: "Andre",
    attendanceStatus: "maybe",
    chaptersReadThrough: 4,
    readingComplete: false,
  }, {
    userId: "kayla",
    userName: "Kayla",
    attendanceStatus: "attending",
    chaptersReadThrough: 8,
    readingComplete: true,
  }, {
    userId: "ting",
    userName: "Ting",
    attendanceStatus: "not_attending",
    chaptersReadThrough: 0,
    readingComplete: false,
  }, {
    userId: "sheryl",
    userName: "Sheryl",
    attendanceStatus: null,
    chaptersReadThrough: 3,
    readingComplete: false,
  }],
};

function renderMeeting({ intent = null, canAdminister = false, onEdit = vi.fn() } = {}) {
  return render(
    <MemoryRouter>
      <ModuleFocusProvider intent={intent}>
        <BookClubMeetingFeature
          meetings={[MEETING]}
          moduleTag={<span>Book Club</span>}
          onEdit={onEdit}
          canAdminister={canAdminister}
          onChanged={vi.fn()}
        />
      </ModuleFocusProvider>
    </MemoryRouter>,
  );
}

describe("BookClubMeetingFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBookClubMeeting.mockResolvedValue({ meeting: MEETING });
    setBookClubResponse.mockResolvedValue({ meeting: MEETING });
  });
  afterEach(() => cleanup());

  it("restores expandable meeting details and a focused forum link", async () => {
    renderMeeting();

    const header = screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    });
    expect(document.querySelector("[inert]")).toBeInTheDocument();
    await userEvent.click(header);

    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(getBookClubMeeting).toHaveBeenCalledWith("andre", "meeting#1");
    expect(screen.getByText("Chapter 8")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Forum" })).toHaveAttribute(
      "href",
      "/?book=book-1&meeting=meeting%231",
    );
  });

  it("keeps administration actions inside the expanded feed card", async () => {
    const onEdit = vi.fn();
    renderMeeting({ canAdminister: true, onEdit });
    await userEvent.click(screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    }));

    expect(screen.getByRole("button", { name: "Send reminder" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Complete meeting" })).toBeInTheDocument();
  });

  it("updates the viewer response inline", async () => {
    renderMeeting();
    await userEvent.click(screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    }));
    await userEvent.selectOptions(screen.getByLabelText("Your attendance"), "attending");
    expect(setBookClubResponse).toHaveBeenCalledWith(
      "andre",
      "meeting#1",
      { attendanceStatus: "attending" },
    );
  });

  it("shows one member row and an attendance total for every response", async () => {
    renderMeeting();
    await userEvent.click(screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    }));

    const responseList = screen.getByRole("list", { name: "Member attendance and progress" });
    expect(within(responseList).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByLabelText("Attendance totals")).toHaveTextContent(
      "1 Attending1 Maybe1 Not attending1 Pending",
    );
    const kaylaRow = within(responseList).getByText("Kayla").closest('[role="listitem"]');
    expect(within(kaylaRow).getByText("Complete")).toBeInTheDocument();
  });

  it("saves chapter progress and completion mode independently", async () => {
    renderMeeting();
    await userEvent.click(screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    }));

    const chapter = screen.getByLabelText("Chapters read through");
    await userEvent.clear(chapter);
    await userEvent.type(chapter, "7");
    await userEvent.tab();
    expect(setBookClubResponse).toHaveBeenCalledWith(
      "andre", "meeting#1", { chaptersReadThrough: 7 },
    );

    await userEvent.selectOptions(screen.getByLabelText("Your reading progress mode"), "complete");
    expect(setBookClubResponse).toHaveBeenCalledWith(
      "andre", "meeting#1", { readingComplete: true },
    );
  });

  it("expands a meeting targeted by a household notification", async () => {
    renderMeeting({
      intent: { itemId: "meeting#1", token: "book-club:meeting#1" },
    });
    expect(await screen.findByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: true,
    })).toBeInTheDocument();
    expect(getBookClubMeeting).toHaveBeenCalledWith("andre", "meeting#1");
  });
});

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import BookClubMeetingFeature from "./BookClubMeetingFeature.jsx";
import {
  completeBookClubMeeting,
  getBookClubMeeting,
  setBookClubResponse,
} from "../../api/bookClub.js";
import { ModuleFocusProvider } from "../../context/ModuleFocusContext.jsx";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getBookClubMeeting: vi.fn(),
  setBookClubResponse: vi.fn(),
  completeBookClubMeeting: vi.fn(),
}));
vi.mock("./BookClubForum.jsx", () => ({
  default: ({ meeting }) => (
    <div data-testid={`discussion-${meeting.id}`}>Discussion for {meeting.readingTarget}</div>
  ),
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
  }, {
    userId: "kayla",
    userName: "Kayla",
    attendanceStatus: "attending",
  }, {
    userId: "ting",
    userName: "Ting",
    attendanceStatus: "not_attending",
  }, {
    userId: "sheryl",
    userName: "Sheryl",
    attendanceStatus: null,
  }],
};

function renderMeeting({ intent = null, canAdminister = false, onEdit = vi.fn() } = {}) {
  return render(
    <MemoryRouter>
      <ModuleFocusProvider intent={intent}>
        <BookClubMeetingFeature
          meeting={MEETING}
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

  it("shows collapsed attendance and discussion with a full-book link", async () => {
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
    const attendance = screen.getByRole("region", { name: "Attendance" });
    const discussion = screen.getByRole("region", { name: "Discussion" });
    const attendanceToggle = within(attendance).getByRole("button", { name: /Attendance/ });
    const discussionToggle = within(discussion).getByRole("button", { name: /Discussion/ });

    expect(attendanceToggle).toHaveAttribute("aria-expanded", "false");
    expect(discussionToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Member attendance").closest("[inert]"))
      .toBeInTheDocument();
    expect(screen.queryByTestId("discussion-meeting#1")).not.toBeInTheDocument();

    await userEvent.click(attendanceToggle);
    expect(attendanceToggle).toHaveAttribute("aria-expanded", "true");
    expect(discussionToggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(discussionToggle);
    expect(screen.getByTestId("discussion-meeting#1")).toHaveTextContent("Chapter 8");
    expect(screen.getByRole("link", { name: "View book" })).toHaveAttribute(
      "href",
      "/?book=book-1",
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
    expect(screen.getByRole("button", { name: "Send reminder" })).toHaveClass(
      "ui-pillSecondary",
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "View book" })).toHaveClass("ui-pillSecondary");
    expect(screen.getByRole("button", { name: "Complete meeting" })).toHaveClass(
      "ui-pillDanger",
    );
  });

  it("requires explicit confirmation before completing a meeting", async () => {
    completeBookClubMeeting.mockResolvedValue({});
    renderMeeting({ canAdminister: true });
    await userEvent.click(screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    }));

    await userEvent.click(screen.getByRole("button", { name: "Complete meeting" }));
    expect(completeBookClubMeeting).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await userEvent.click(within(screen.getByRole("dialog", { name: /Complete meeting/ })).getByRole("button", { name: "Complete meeting" }));
    expect(completeBookClubMeeting).toHaveBeenCalledWith("andre", "meeting#1");
  });

  it("updates the viewer response inline", async () => {
    setBookClubResponse.mockResolvedValueOnce({
      meeting: {
        ...MEETING,
        responses: MEETING.responses.map((response) => (
          response.userId === "andre"
            ? { ...response, attendanceStatus: "attending" }
            : response
        )),
      },
    });
    renderMeeting();
    await userEvent.click(screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    }));
    await userEvent.click(screen.getByRole("button", { name: /Attendance/ }));
    await userEvent.selectOptions(screen.getByLabelText("Your RSVP"), "attending");
    expect(setBookClubResponse).toHaveBeenCalledWith(
      "andre",
      "meeting#1",
      { attendanceStatus: "attending" },
    );
    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "Attending: 2" })).getByText("Andre"))
        .toBeInTheDocument();
    });
  });

  it("groups every member by attendance status with explicit counts", async () => {
    renderMeeting();
    await userEvent.click(screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    }));
    await userEvent.click(screen.getByRole("button", { name: /Attendance/ }));

    const attendance = screen.getByLabelText("Member attendance");
    expect(within(screen.getByRole("region", { name: "Attending: 1" })).getByText("Kayla"))
      .toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Maybe: 1" })).getByText("Andre"))
      .toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Not attending: 1" })).getByText("Ting"))
      .toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Pending: 1" })).getByText("Sheryl"))
      .toBeInTheDocument();
    expect(within(attendance).getAllByRole("listitem")).toHaveLength(4);
    expect(within(screen.getByRole("region", { name: "Maybe: 1" })).getByText("You"))
      .toBeInTheDocument();
  });

  it("keeps completed meeting attendance read-only", async () => {
    getBookClubMeeting.mockResolvedValueOnce({ meeting: { ...MEETING, status: "completed" } });
    renderMeeting();
    await userEvent.click(screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    }));
    await userEvent.click(screen.getByRole("button", { name: /Attendance/ }));

    await waitFor(() => expect(screen.queryByLabelText("Your RSVP")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Member attendance")).toBeInTheDocument();
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

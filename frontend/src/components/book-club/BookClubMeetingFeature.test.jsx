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
import { exactDateTime } from "../../utils/time.js";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getBookClubMeeting: vi.fn(),
  setBookClubResponse: vi.fn(),
  completeBookClubMeeting: vi.fn(),
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

function renderMeeting({ meeting = MEETING, intent = null, canAdminister = false, onEdit = vi.fn() } = {}) {
  return render(
    <MemoryRouter>
      <ModuleFocusProvider intent={intent}>
        <BookClubMeetingFeature
          meeting={meeting}
          moduleTag={<span>Books</span>}
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

  it("leads with the meeting time and keeps reading details below", async () => {
    renderMeeting();

    const header = screen.getByRole("button", {
      name: /Book Club meeting .*Chapter 8/,
      expanded: false,
    });
    const bookLink = screen.getByRole("link", {
      name: "View The Left Hand of Darkness in the Book Club library",
    });
    expect(screen.getByText("Books").nextElementSibling).toHaveTextContent(
      exactDateTime(MEETING.scheduledAt),
    );
    expect(screen.getByText("Chapter 8 · Snacks: Andre")).toBeInTheDocument();
    expect(bookLink).toHaveAttribute("href", "/?book=book-1");
    expect(document.querySelector("[inert]")).toBeInTheDocument();
    await userEvent.click(header);

    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(getBookClubMeeting).toHaveBeenCalledWith("andre", "meeting#1");
    expect(screen.getByText("Chapter 8")).toBeInTheDocument();
    expect(screen.queryByText("Ursula K. Le Guin")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View book" })).not.toBeInTheDocument();
    const attendance = screen.getByRole("region", { name: "Attendance" });
    expect(within(attendance).queryByRole("button", { name: /Attendance/ })).not.toBeInTheDocument();
    expect(within(attendance).queryByText("Attendance")).not.toBeInTheDocument();
    expect(within(attendance).queryByText("4 members")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Member attendance").closest("[inert]")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Discussion" })).not.toBeInTheDocument();
  });

  it("keeps administration actions inside the expanded feed card", async () => {
    const onEdit = vi.fn();
    renderMeeting({ canAdminister: true, onEdit });
    await userEvent.click(screen.getByRole("button", {
      name: /Book Club meeting .*Chapter 8/,
      expanded: false,
    }));

    expect(screen.getByRole("button", { name: "Send reminder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send reminder" })).toHaveClass(
      "ui-pillSecondary",
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: "View book" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete meeting" })).toHaveClass(
      "ui-pillDanger",
    );
  });

  it("requires explicit confirmation before completing a meeting", async () => {
    completeBookClubMeeting.mockResolvedValue({});
    renderMeeting({ canAdminister: true });
    await userEvent.click(screen.getByRole("button", {
      name: /Book Club meeting .*Chapter 8/,
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
      name: /Book Club meeting .*Chapter 8/,
      expanded: false,
    }));
    await userEvent.selectOptions(screen.getByLabelText("RSVP"), "attending");
    expect(setBookClubResponse).toHaveBeenCalledWith(
      "andre",
      "meeting#1",
      { attendanceStatus: "attending" },
    );
    await waitFor(() => {
      expect(within(screen.getByLabelText("Member attendance")).getByRole("button", {
        name: "View 2 people marked attending",
      })).toBeInTheDocument();
    });
    const attendance = screen.getByLabelText("Member attendance");
    expect(screen.getByRole("region", { name: "Attending: 2" }))
      .toHaveTextContent("Attending2");
    expect(screen.getByRole("region", { name: "Maybe: 0" }))
      .toHaveTextContent("Maybe0");
    expect(within(screen.getByRole("region", { name: "Maybe: 0" }))
      .queryByRole("button", { name: /marked maybe/ }))
      .not.toBeInTheDocument();
    const attending = within(attendance).getByRole("button", {
      name: "View 2 people marked attending",
    });
    await userEvent.click(attending);
    expect(screen.getByRole("dialog", { name: "Attending members" })).toHaveTextContent("Andre");
  });

  it("groups every member by attendance status with explicit counts", async () => {
    renderMeeting();
    await userEvent.click(screen.getByRole("button", {
      name: /Book Club meeting .*Chapter 8/,
      expanded: false,
    }));
    const attendance = screen.getByLabelText("Member attendance");
    expect(attendance).not.toHaveTextContent("Kayla");
    expect(within(attendance).getAllByRole("region").map((row) => (
      row.getAttribute("aria-label")
    ))).toEqual([
      "Attending: 1",
      "Maybe: 1",
      "Not attending: 1",
      "Pending: 1",
    ]);

    for (const [label, person] of [
      ["Attending", "Kayla"],
      ["Maybe", "Andre"],
      ["Not attending", "Ting"],
      ["Pending", "Sheryl"],
    ]) {
      const status = {
        Attending: "attending",
        Maybe: "maybe",
        "Not attending": "not_attending",
        Pending: "pending",
      }[label];
      const trigger = within(attendance).getByRole("button", {
        name: `View 1 person marked ${label.toLowerCase()}`,
      });
      const row = screen.getByRole("region", { name: `${label}: 1` });
      expect(row).toHaveTextContent(`${label}1`);
      expect(row.querySelector(`[data-attendance-status-indicator="${status}"]`))
        .toBeInTheDocument();
      expect(within(trigger).getByText(person.charAt(0))).toBeInTheDocument();
      await userEvent.click(trigger);
      expect(screen.getByRole("dialog", { name: `${label} members` }))
        .toHaveTextContent(person);
      await userEvent.click(trigger);
    }
  });

  it("shows a responsive additional count after the visible member avatars", async () => {
    const crowdedMeeting = {
      ...MEETING,
      responses: Array.from({ length: 6 }, (_, index) => ({
        userId: index === 0 ? "andre" : `member-${index}`,
        userName: index === 0 ? "Andre" : `Member ${index}`,
        attendanceStatus: "attending",
      })),
    };
    getBookClubMeeting.mockResolvedValueOnce({ meeting: crowdedMeeting });
    renderMeeting({ meeting: crowdedMeeting });
    await userEvent.click(screen.getByRole("button", {
      name: /Book Club meeting .*Chapter 8/,
      expanded: false,
    }));
    const attending = within(screen.getByLabelText("Member attendance"))
      .getByRole("button", { name: "View 6 people marked attending" });
    expect(within(attending).getByText("+2")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Maybe: 0" })).toHaveTextContent("Maybe0");
    expect(within(screen.getByRole("region", { name: "Maybe: 0" }))
      .queryByRole("button")).not.toBeInTheDocument();
    await userEvent.click(attending);
    expect(screen.getByRole("dialog", { name: "Attending members" }))
      .toHaveTextContent("Member 5");
  });

  it("keeps completed meeting attendance read-only", async () => {
    getBookClubMeeting.mockResolvedValueOnce({ meeting: { ...MEETING, status: "completed" } });
    renderMeeting();
    await userEvent.click(screen.getByRole("button", {
      name: /Book Club meeting .*Chapter 8/,
      expanded: false,
    }));
    await waitFor(() => expect(screen.queryByLabelText("RSVP")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Member attendance")).toBeInTheDocument();
    expect(document.querySelector(".ui-moduleActionRow")).not.toBeInTheDocument();
  });

  it("expands a meeting targeted by a household notification", async () => {
    renderMeeting({
      intent: { itemId: "meeting#1", token: "book-club:meeting#1" },
    });
    expect(await screen.findByRole("button", {
      name: /Book Club meeting .*Chapter 8/,
      expanded: true,
    })).toBeInTheDocument();
    expect(getBookClubMeeting).toHaveBeenCalledWith("andre", "meeting#1");
  });
});

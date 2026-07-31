import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as pollsApi from "../../api/polls.js";
import PollFeature from "./PollFeature.jsx";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/polls.js", () => ({
  addPollOption: vi.fn(),
  archivePoll: vi.fn(),
  commentOnPoll: vi.fn(),
  deletePoll: vi.fn(),
  editPollOption: vi.fn(),
  restorePoll: vi.fn(),
  setPollCommentLiked: vi.fn(),
  setPollVote: vi.fn(),
}));

const ROOMMATES = [
  { id: "andre", name: "Andre" },
  { id: "kayla", name: "Kayla" },
];

const POLL = {
  id: "poll-1",
  title: "Dinner?",
  createdById: "andre",
  createdBy: "Andre",
  createdAt: 1,
  updatedAt: 1,
  isArchived: false,
  options: [
    {
      id: "thai",
      text: "Thai",
      voterIds: ["andre", "kayla"],
      voters: ROOMMATES,
    },
  ],
  comments: [
    {
      id: "comment-1",
      author: "Kayla",
      authorId: "kayla",
      text: "Thai sounds good",
      createdAt: 2,
      mentions: [],
      mentionsAll: false,
      likedByIds: [],
      likeCount: 0,
    },
  ],
};

function renderPoll(overrides = {}) {
  const poll = { ...POLL, ...overrides };
  const onPollsChange = vi.fn().mockResolvedValue();
  render(
    <PollFeature
      poll={poll}
      roommates={ROOMMATES}
      onPollsChange={onPollsChange}
      moduleTag={<span>Polls</span>}
      onEdit={vi.fn()}
    />,
  );
  return { onPollsChange };
}

describe("PollFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(pollsApi).forEach((mock) => {
      mock.mockResolvedValue([POLL]);
    });
  });
  afterEach(() => cleanup());

  it("uses the mounted module animation without an expand glyph", async () => {
    renderPoll();
    const header = screen.getByRole("button", { name: /Polls Dinner/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("[inert]")).toBeInTheDocument();
    expect(screen.queryByText("+")).not.toBeInTheDocument();
    expect(screen.queryByText("−")).not.toBeInTheDocument();

    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector("[inert]")).not.toBeInTheDocument();
  });

  it.each([
    ["No votes yet", []],
    [
      "1 voter",
      [
        {
          id: "thai",
          text: "Thai",
          voterIds: ["andre"],
          voters: [ROOMMATES[0]],
        },
        {
          id: "pizza",
          text: "Pizza",
          voterIds: ["andre"],
          voters: [ROOMMATES[0]],
        },
      ],
    ],
    [
      "2 voters",
      [
        {
          id: "thai",
          text: "Thai",
          voterIds: ["andre", "kayla"],
          voters: ROOMMATES,
        },
        {
          id: "pizza",
          text: "Pizza",
          voterIds: ["andre"],
          voters: [ROOMMATES[0]],
        },
      ],
    ],
  ])("summarizes unique participation as %s", (summary, options) => {
    renderPoll({ options });
    expect(
      screen.getByRole("button", { name: /Polls Dinner/ }),
    ).toHaveTextContent(summary);
  });

  it("separates voting from creator tap-to-edit", async () => {
    renderPoll();
    await userEvent.click(screen.getByRole("button", { name: /Polls Dinner/ }));

    await userEvent.click(screen.getByRole("button", { name: "Thai" }));
    expect(screen.getByDisplayValue("Thai")).toBeInTheDocument();
    expect(pollsApi.setPollVote).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Cancel editing poll option" }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Remove vote from Thai" }),
    );
    expect(pollsApi.setPollVote).toHaveBeenCalledWith(
      "poll-1",
      "thai",
      "andre",
      false,
    );
  });

  it("keeps option text non-interactive for roommates who are not the creator", async () => {
    renderPoll({ createdById: "kayla", createdBy: "Kayla" });
    await userEvent.click(screen.getByRole("button", { name: /Polls Dinner/ }));

    expect(screen.getByText("Thai")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thai" })).not.toBeInTheDocument();
  });

  it("opens the vote count and avatar list in a people popover", async () => {
    renderPoll();
    await userEvent.click(screen.getByRole("button", { name: /Polls Dinner/ }));
    await userEvent.click(
      screen.getByRole("button", {
        name: "View 2 people who voted for Thai",
      }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "People who voted for Thai",
    });
    expect(dialog).toHaveTextContent("Voted by");
    expect(dialog).toHaveTextContent("Andre");
    expect(dialog).toHaveTextContent("Kayla");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it("caps the inline avatar preview while keeping every voter inspectable", async () => {
    const voters = [
      ...ROOMMATES,
      { id: "sam", name: "Sam" },
      { id: "priya", name: "Priya" },
    ];
    renderPoll({
      options: [
        {
          id: "thai",
          text: "Thai",
          voterIds: voters.map((person) => person.id),
          voters,
        },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: /Polls Dinner/ }));
    const trigger = screen.getByRole("button", {
      name: "View 4 people who voted for Thai",
    });
    expect(trigger.querySelector('[aria-hidden="true"]').children).toHaveLength(
      3,
    );

    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: "People who voted for Thai",
    });
    for (const voter of voters) expect(dialog).toHaveTextContent(voter.name);
  });

  it("closes option editors and voter popovers when the poll collapses", async () => {
    renderPoll();
    const header = screen.getByRole("button", { name: /Polls Dinner/ });
    await userEvent.click(header);
    await userEvent.click(
      screen.getByRole("button", {
        name: "View 2 people who voted for Thai",
      }),
    );
    expect(screen.getByRole("dialog", {
      name: "People who voted for Thai",
    })).toBeInTheDocument();

    await userEvent.click(header);
    expect(screen.queryByRole("dialog", {
      name: "People who voted for Thai",
    })).not.toBeInTheDocument();

    await userEvent.click(header);
    await userEvent.click(screen.getByRole("button", { name: "Thai" }));
    expect(screen.getByDisplayValue("Thai")).toBeInTheDocument();
    await userEvent.click(header);
    await userEvent.click(header);
    expect(screen.queryByDisplayValue("Thai")).not.toBeInTheDocument();
  });

  it("posts comments through the shared comment section", async () => {
    const { onPollsChange } = renderPoll();
    await userEvent.click(screen.getByRole("button", { name: /Polls Dinner/ }));
    await userEvent.type(
      screen.getByPlaceholderText("Add a comment… Use @ to mention someone"),
      "Pizza also works",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Send comment" }),
    );

    expect(pollsApi.commentOnPoll).toHaveBeenCalledWith(
      "poll-1",
      "andre",
      "Pizza also works",
    );
    expect(onPollsChange).toHaveBeenCalled();
  });

  it("reuses mention suggestions and refreshes after comment likes", async () => {
    const comment = {
      ...POLL.comments[0],
      likedByIds: ["kayla"],
      likeCount: 1,
    };
    const { onPollsChange } = renderPoll({ comments: [comment] });
    await userEvent.click(screen.getByRole("button", { name: /Polls Dinner/ }));

    const composer = screen.getByPlaceholderText(
      "Add a comment… Use @ to mention someone",
    );
    await userEvent.type(composer, "@ka");
    expect(screen.getByRole("option", { name: "@Kayla" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Like comment" }));
    expect(pollsApi.setPollCommentLiked).toHaveBeenCalledWith(
      "poll-1",
      "comment-1",
      "andre",
      true,
    );
    expect(onPollsChange).toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", {
        name: "View 1 person who liked this comment",
      }),
    );
    expect(screen.getByRole("dialog", {
      name: "People who liked this comment",
    })).toHaveTextContent("Kayla");
  });

  it("keeps archived comments visible but removes editing controls", async () => {
    renderPoll({
      isArchived: true,
      comments: [{
        ...POLL.comments[0],
        likedByIds: ["andre"],
        likeCount: 1,
      }],
    });
    await userEvent.click(screen.getByRole("button", { name: /Polls Dinner/ }));
    expect(screen.getByText("Thai sounds good")).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Add a comment… Use @ to mention someone"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thai" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlike comment" })).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", {
        name: "View 1 person who liked this comment",
      }),
    );
    expect(screen.getByRole("dialog", {
      name: "People who liked this comment",
    })).toHaveTextContent("Andre");
  });
});

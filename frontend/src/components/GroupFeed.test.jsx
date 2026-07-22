import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import GroupFeed from "./GroupFeed.jsx";
import { getFeed, updateModule } from "../api/client.js";
import { LONG_PRESS_MS } from "../utils/useLongPress.js";

vi.mock("../context/AuthContext.jsx", () => ({
  useAuth: () => ({
    user: {
      id: "andre",
      name: "Andre",
      hasGroup: true,
      groupId: "shire",
      activeGroupId: "shire",
    },
  }),
}));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getFeed: vi.fn(), updateModule: vi.fn() };
});

const ROOMMATES = [
  { id: "andre", name: "Andre" },
  { id: "kayla", name: "Kayla" },
];

function feedItem(type, id = `${type}-1`, isArchived = false) {
  const common = {
    id,
    type,
    createdAt: 1,
    updatedAt: 1,
    sortAt: 1,
    title: `${type} title`,
    subtitle: type,
    actor: "Andre",
    isArchived,
  };
  const payloads = {
    events: {
      id,
      text: "Movie night",
      proposedBy: "Andre",
      proposedById: "andre",
      members: ["Andre"],
      memberIds: ["andre"],
      comments: [],
      createdAt: 1,
      updatedAt: 1,
      startAt: null,
      endAt: null,
      isLive: false,
      isExpired: false,
      isArchived,
    },
    requests: {
      id,
      text: "Pick up milk",
      requester: "Andre",
      requesterId: "andre",
      requestedIds: ["kayla"],
      requested: [{ id: "kayla", name: "Kayla", response: "pending" }],
      comments: [],
      createdAt: 1,
      updatedAt: 1,
      isArchived,
    },
    checklists: {
      id,
      title: "Kitchen reset",
      createdBy: "Andre",
      createdById: "andre",
      items: [],
      createdAt: 1,
      updatedAt: 1,
      isArchived,
    },
    tv: {
      id,
      title: "Severance",
      createdBy: "Andre",
      createdById: "andre",
      members: [],
      createdAt: 1,
      updatedAt: 1,
      isArchived,
    },
    spotify: {
      id,
      hostId: "andre",
      hostName: "Andre",
      link: "https://spotify.link/jam",
      createdAt: 1,
      updatedAt: 1,
    },
  };
  return { ...common, payload: payloads[type] };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderFeed(initialUrl, items) {
  getFeed.mockResolvedValue(items);
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <GroupFeed roommates={ROOMMATES} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function cardForText(text) {
  return screen.getByText(text).closest('[role="button"]');
}

function editHeaderForText(text) {
  return screen.getByText(text).closest("[data-module-edit-header]");
}

async function longPress(element) {
  fireEvent.pointerDown(element, {
    pointerId: 1,
    pointerType: "touch",
    clientX: 20,
    clientY: 20,
  });
  await act(
    () => new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 20)),
  );
  fireEvent.pointerUp(element, { pointerId: 1, pointerType: "touch" });
}

describe("GroupFeed module focus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateModule.mockResolvedValue({ module: {} });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => cleanup());

  it("reports when the active group feed has finished loading", async () => {
    let resolveFeed;
    getFeed.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFeed = resolve;
        }),
    );
    const onLoadStateChange = vi.fn();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <GroupFeed
          roommates={ROOMMATES}
          onLoadStateChange={onLoadStateChange}
        />
      </MemoryRouter>,
    );

    expect(onLoadStateChange).toHaveBeenCalledWith("shire", true);
    resolveFeed([]);
    await waitFor(() =>
      expect(onLoadStateChange).toHaveBeenCalledWith("shire", false),
    );
  });

  it("adds theme hooks to tags, create cards, and typed filters", async () => {
    const items = ["events", "requests", "checklists", "tv", "spotify"].map(
      (type) => feedItem(type),
    );
    renderFeed("/", items);
    const user = userEvent.setup();

    await screen.findByText("Movie night");
    await user.click(screen.getByRole("button", { name: "Create a module" }));

    const themedTypes = ["events", "requests", "checklists", "tv"];
    themedTypes.forEach((type) => {
      expect(
        document.querySelectorAll(`[data-module-type="${type}"]`),
      ).toHaveLength(3);
    });
    expect(
      document.querySelectorAll('[data-module-type="spotify"]'),
    ).toHaveLength(0);
    expect(screen.getByRole("button", { name: /^All/ })).not.toHaveAttribute(
      "data-module-type",
    );
  });

  it.each([
    ["events", "Movie night"],
    ["requests", "Pick up milk"],
    ["checklists", "Kitchen reset"],
    ["tv", "Severance"],
  ])("opens and scrolls the %s module exactly once", async (type, label) => {
    const module = feedItem(type);
    renderFeed(`/?module=${type}&item=${module.id}`, [module]);

    await waitFor(() =>
      expect(cardForText(label)).toHaveAttribute("aria-expanded", "true"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(""),
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("consumes legacy Spotify module destinations without showing a filter error", async () => {
    const module = feedItem("spotify", "activeJam#shire");
    renderFeed("/?module=spotify&item=activeJam%23shire", [module]);

    await screen.findByText("No active modules here yet.");
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(""),
    );
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { expanded: true }),
    ).not.toBeInTheDocument();
  });

  it("reveals archived targets before focusing them", async () => {
    const module = feedItem("requests", "request-archived", true);
    renderFeed("/?module=requests&item=request-archived", [module]);

    await waitFor(() =>
      expect(cardForText("Pick up milk")).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );
    expect(
      screen.getByRole("button", { name: /Archived \(1\)/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("consumes missing targets without retrying scroll", async () => {
    renderFeed("/?module=requests&item=missing", []);

    expect(
      await screen.findByText("That module is no longer available."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("");
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("handles filter-only and unknown module destinations without scrolling", async () => {
    renderFeed("/?module=tv", [feedItem("tv")]);
    expect(
      await screen.findByRole("heading", { name: "TV" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(""),
    );
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    cleanup();
    renderFeed("/?module=unknown&item=one", []);
    expect(
      await screen.findByText("That module type is not available."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("");
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("preserves a request draft and manual close across feed refreshes", async () => {
    const module = feedItem("requests");
    renderFeed(`/?module=requests&item=${module.id}`, [module]);
    const user = userEvent.setup();

    const input = await screen.findByPlaceholderText(/Add a comment/);
    await waitFor(() =>
      expect(cardForText("Pick up milk")).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );
    await user.type(input, "draft survives polling");

    getFeed.mockResolvedValue([{ ...module, payload: { ...module.payload } }]);
    fireEvent.focus(window);
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(2));
    expect(input).toHaveValue("draft survives polling");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText("Pick up milk"));
    expect(cardForText("Pick up milk")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.focus(window);
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(3));
    expect(cardForText("Pick up milk")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["events", "Movie night"],
    ["requests", "Pick up milk"],
  ])(
    "opens and reopens %s cards at the latest comment without snapping on refresh",
    async (type, label) => {
      const module = feedItem(type);
      module.payload.comments = [
        {
          id: "comment-1",
          author: "Kayla",
          authorId: "kayla",
          text: "First comment",
          createdAt: 1,
          likedByIds: [],
          likeCount: 0,
        },
        {
          id: "comment-2",
          author: "Andre",
          authorId: "andre",
          text: "Latest comment",
          createdAt: 2,
          likedByIds: [],
          likeCount: 0,
        },
      ];
      renderFeed("/", [module]);
      const user = userEvent.setup();

      const scroller = (await screen.findByText("Latest comment")).closest(
        "ul",
      ).parentElement;
      Object.defineProperty(scroller, "scrollHeight", {
        configurable: true,
        value: 480,
      });

      await user.click(screen.getByText(label));
      expect(scroller.scrollTop).toBe(480);

      scroller.scrollTop = 24;
      getFeed.mockResolvedValue([
        { ...module, payload: { ...module.payload } },
      ]);
      fireEvent.focus(window);
      await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(2));
      expect(scroller.scrollTop).toBe(24);

      await user.click(screen.getByText(label));
      await user.click(screen.getByText(label));
      expect(scroller.scrollTop).toBe(480);
    },
  );

  it.each([
    ["events", "Edit event", "Event", "Movie night"],
    ["requests", "Edit request", "Request", "Pick up milk"],
    ["checklists", "Edit checklist", "Checklist title", "Kitchen reset"],
    ["tv", "Edit show", "Show title", "Severance"],
  ])(
    "opens a prepopulated creator editor for %s",
    async (type, editLabel, fieldLabel, value) => {
      renderFeed("/", [feedItem(type)]);
      const user = userEvent.setup();

      await screen.findByText(value);
      expect(
        screen.queryByRole("button", { name: editLabel }),
      ).not.toBeInTheDocument();
      await longPress(editHeaderForText(value));
      expect(
        screen.getByRole("dialog", { name: editLabel }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(fieldLabel)).toHaveValue(value);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
    },
  );

  it("opens from an expanded header without collapsing the card", async () => {
    renderFeed("/", [feedItem("requests")]);
    const user = userEvent.setup();

    await user.click(await screen.findByText("Pick up milk"));
    expect(cardForText("Pick up milk")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await longPress(editHeaderForText("Pick up milk"));

    expect(
      screen.getByRole("dialog", { name: "Edit request" }),
    ).toBeInTheDocument();
    expect(cardForText("Pick up milk")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("uses a keyboard hold for editing while a short key press still expands", async () => {
    renderFeed("/", [feedItem("requests")]);
    await screen.findByText("Pick up milk");
    const card = cardForText("Pick up milk");

    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyUp(card, { key: "Enter" });
    expect(card).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(card, { key: "Enter" });
    await act(
      () => new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 20)),
    );
    fireEvent.keyUp(card, { key: "Enter" });

    expect(
      screen.getByRole("dialog", { name: "Edit request" }),
    ).toBeInTheDocument();
    expect(card).toHaveAttribute("aria-expanded", "true");
  });

  it("cancels a header hold when the pointer moves like a scroll or swipe", async () => {
    renderFeed("/", [feedItem("requests")]);
    await screen.findByText("Pick up milk");
    const header = editHeaderForText("Pick up milk");

    fireEvent.pointerDown(header, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 20,
      clientY: 20,
    });
    fireEvent(
      header,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 45,
        clientY: 20,
      }),
    );
    await act(
      () => new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 20)),
    );
    fireEvent.pointerUp(header, { pointerId: 1, pointerType: "touch" });

    expect(
      screen.queryByRole("dialog", { name: "Edit request" }),
    ).not.toBeInTheDocument();
  });

  it("does not expose editing to non-creators or archived module owners", async () => {
    const nonOwner = feedItem("requests");
    nonOwner.payload.requesterId = "kayla";
    renderFeed("/", [nonOwner, feedItem("checklists", "archived", true)]);
    const user = userEvent.setup();

    await screen.findByText("Pick up milk");
    expect(editHeaderForText("Pick up milk")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Archived \(1\)/ }));
    expect(editHeaderForText("Kitchen reset")).toBeNull();
  });

  it("removes the event-specific schedule editor", async () => {
    renderFeed("/", [feedItem("events")]);
    const user = userEvent.setup();

    await user.click(await screen.findByText("Movie night"));
    expect(screen.queryByText("Schedule")).not.toBeInTheDocument();
  });

  it("switches filters when swiping directly on a module card", async () => {
    renderFeed("/", [feedItem("events"), feedItem("requests")]);

    await screen.findByText("Movie night");
    const card = cardForText("Movie night");
    fireEvent.pointerDown(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 120,
    });
    fireEvent.pointerUp(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 80,
      clientY: 126,
    });

    expect(screen.getByRole("heading", { name: "Events" })).toBeInTheDocument();
  });

  it("supports touch drag ordering in filter edit mode", async () => {
    renderFeed("/", [feedItem("events"), feedItem("requests")]);
    const user = userEvent.setup();

    await screen.findByText("Movie night");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const requestDropTarget = document.querySelector(
      '[data-module-drop-type="requests"]',
    );
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => requestDropTarget),
    });

    const eventsHandle = screen.getByRole("button", {
      name: "Drag Events to reorder",
    });
    fireEvent.pointerDown(eventsHandle, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 230,
      clientY: 140,
    });
    fireEvent.pointerUp(eventsHandle, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 230,
      clientY: 188,
    });

    await user.click(screen.getByRole("button", { name: "Done" }));
    const card = cardForText("Movie night");
    fireEvent.pointerDown(card, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 180,
      clientY: 120,
    });
    fireEvent.pointerUp(card, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 80,
      clientY: 126,
    });

    expect(
      screen.getByRole("heading", { name: "Requests" }),
    ).toBeInTheDocument();
  });

  it("preserves an open edit draft across polling and saves through the generic API", async () => {
    const module = feedItem("requests");
    renderFeed("/", [module]);
    const user = userEvent.setup();

    await screen.findByText("Pick up milk");
    await longPress(editHeaderForText("Pick up milk"));
    const input = screen.getByLabelText("Request");
    await user.clear(input);
    await user.type(input, "draft request text");

    getFeed.mockResolvedValue([
      {
        ...module,
        payload: { ...module.payload, text: "server refresh text" },
      },
    ]);
    fireEvent.focus(window);
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(2));
    expect(input).toHaveValue("draft request text");

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(updateModule).toHaveBeenCalledWith(
        "requests",
        module.id,
        "andre",
        {
          text: "draft request text",
          requestedIds: ["kayla"],
        },
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit request" }),
      ).not.toBeInTheDocument(),
    );
  });
});

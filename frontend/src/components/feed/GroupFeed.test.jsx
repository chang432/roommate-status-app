import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import GroupFeed from "./GroupFeed.jsx";
import { getFeed, updateModule } from "../../api/feed.js";

vi.mock("../../context/AuthContext.jsx", () => ({
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

vi.mock("../../api/feed.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getFeed: vi.fn(), updateModule: vi.fn() };
});

const ROOMMATES = [
  { id: "andre", name: "Andre" },
  { id: "kayla", name: "Kayla" },
];
const MODULE_PREFERENCE_KEY = "roomie-module-preferences:andre:shire";

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
    polls: {
      id,
      title: "Dinner?",
      createdBy: "Andre",
      createdById: "andre",
      options: [],
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
    "book-club": {
      id,
      bookId: "book-1",
      bookTitle: "The Left Hand of Darkness",
      bookAuthor: "Ursula K. Le Guin",
      readingTarget: "Chapter 8",
      bookOwnerId: "kayla",
      bookOwnerName: "Kayla",
      snackOwnerId: "andre",
      snackOwnerName: "Andre",
      scheduledAt: 1_912_375_800_000,
      status: isArchived ? "completed" : "scheduled",
      createdById: "andre",
      createdByName: "Andre",
      createdAt: 1,
      updatedAt: 1,
      responses: [],
    },
  };
  return { ...common, payload: payloads[type] };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderFeed(initialUrl, items, props = {}) {
  getFeed.mockResolvedValue(items);
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <GroupFeed roommates={ROOMMATES} {...props} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function cardForText(text) {
  return screen.getByText(text).closest('[role="button"]');
}

function setWindowScrollY(top) {
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    value: top,
  });
}

function feedShellRectAt(documentTop) {
  return {
    top: documentTop - window.scrollY,
    bottom: documentTop - window.scrollY + 900,
    left: 0,
    right: 390,
    x: 0,
    y: documentTop - window.scrollY,
    width: 390,
    height: 900,
    toJSON: () => ({}),
  };
}

async function openModuleNav(user) {
  await user.click(screen.getByRole("button", { name: "Open feed menu" }));
  return screen.getByLabelText("Module types");
}

describe("GroupFeed module focus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setWindowScrollY(0);
    window.scrollTo = vi.fn();
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
    const items = ["events", "requests", "checklists", "polls", "tv", "spotify"].map(
      (type) => feedItem(type),
    );
    renderFeed("/", items);
    const user = userEvent.setup();

    await screen.findByText("Movie night");
    expect(
      screen.getByRole("heading", { name: "Group Feed" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create a module" }));

    const themedTypes = ["events", "requests", "checklists", "polls", "tv"];
    themedTypes.forEach((type) => {
      expect(
        document.querySelectorAll(`[data-module-type="${type}"]`),
      ).toHaveLength(4);
    });
    expect(
      document.querySelectorAll('[data-module-type="spotify"]'),
    ).toHaveLength(0);
    expect(screen.getByRole("tab", { name: /^All/ })).not.toHaveAttribute(
      "data-module-type",
    );
  });

  it("keeps the create action slot mounted when category permissions change", async () => {
    renderFeed(
      "/",
      [feedItem("tv"), feedItem("book-club")],
      { showBookClub: true },
    );
    const user = userEvent.setup();

    await screen.findByText("Severance");
    const createSlot = document.querySelector("[data-feed-create-slot]");
    expect(
      within(createSlot).getByRole("button", { name: "Create a module" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Book Club/ }));
    expect(document.querySelector("[data-feed-create-slot]")).toBe(createSlot);
    expect(within(createSlot).queryByRole("button")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^TV/ }));
    expect(document.querySelector("[data-feed-create-slot]")).toBe(createSlot);
    expect(
      within(createSlot).getByRole("button", { name: "Add a show" }),
    ).toBeInTheDocument();
  });

  it("renders a Book Club-only group without leaking standard modules", async () => {
    renderFeed(
      "/",
      [feedItem("events"), feedItem("book-club")],
      { showStandardModules: false, showBookClub: true },
    );

    expect(await screen.findByText("The Left Hand of Darkness")).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    })).toBeInTheDocument();
    expect(screen.queryByText("Movie night")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Book Club/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Events/ })).not.toBeInTheDocument();
  });

  it("makes polls available in a Book Club-only group", async () => {
    renderFeed(
      "/",
      [feedItem("events"), feedItem("polls"), feedItem("book-club")],
      { showStandardModules: false, showBookClub: true },
    );

    expect(await screen.findByText("Dinner?")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Polls/ })).toBeInTheDocument();
    expect(screen.queryByText("Movie night")).not.toBeInTheDocument();
  });

  it("upgrades legacy All preferences to include Book Club", async () => {
    localStorage.setItem(
      MODULE_PREFERENCE_KEY,
      JSON.stringify({
        order: ["events", "requests", "checklists", "tv"],
        allTypes: ["events", "requests", "checklists", "tv"],
      }),
    );
    renderFeed(
      "/",
      [feedItem("events"), feedItem("book-club")],
      { showBookClub: true },
    );

    expect(
      await screen.findByText("The Left Hand of Darkness"),
    ).toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(MODULE_PREFERENCE_KEY));
      expect(stored.version).toBe(3);
      expect(stored.allTypes).toContain("book-club");
      expect(stored.allTypes).toContain("polls");
    });
  });

  it("preserves an explicit Book Club exclusion from All after remounting", async () => {
    const items = [feedItem("events"), feedItem("book-club")];
    const view = renderFeed("/", items, { showBookClub: true });
    const user = userEvent.setup();

    expect(
      await screen.findByText("The Left Hand of Darkness"),
    ).toBeInTheDocument();
    const moduleNav = await openModuleNav(user);
    await user.click(
      within(moduleNav).getByRole("button", { name: "Edit" }),
    );
    await user.click(screen.getByRole("button", { name: /^All/ }));
    await user.click(screen.getByRole("checkbox", { name: "Book Club" }));
    expect(screen.queryByText("The Left Hand of Darkness")).not.toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(MODULE_PREFERENCE_KEY));
      expect(stored.version).toBe(3);
      expect(stored.allTypes).not.toContain("book-club");
    });

    view.unmount();
    renderFeed("/", items, { showBookClub: true });
    expect(await screen.findByText("Movie night")).toBeInTheDocument();
    expect(screen.queryByText("The Left Hand of Darkness")).not.toBeInTheDocument();
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
      await screen.findByRole("tab", { name: /^TV/, selected: true }),
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
    ["polls", "Dinner?"],
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
      const card = cardForText(value);
      const editButton = within(card).getByRole("button", { name: "Edit" });
      expect(editButton.closest("[inert]")).toBeInTheDocument();
      await user.click(screen.getByText(value));
      expect(editButton.closest("[inert]")).toBeNull();
      await user.click(editButton);
      expect(
        screen.getByRole("dialog", { name: editLabel }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(fieldLabel)).toHaveValue(value);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
    },
  );

  it("opens from the expanded bottom action without collapsing the card", async () => {
    renderFeed("/", [feedItem("requests")]);
    const user = userEvent.setup();

    await user.click(await screen.findByText("Pick up milk"));
    const card = cardForText("Pick up milk");
    expect(card).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await user.click(within(card).getByRole("button", { name: "Edit" }));

    expect(
      screen.getByRole("dialog", { name: "Edit request" }),
    ).toBeInTheDocument();
    expect(card).toHaveAttribute("aria-expanded", "true");
  });

  it("uses keyboard activation only to expand before explicit editing", async () => {
    renderFeed("/", [feedItem("requests")]);
    await screen.findByText("Pick up milk");
    const card = cardForText("Pick up milk");

    fireEvent.keyDown(card, { key: "Enter" });
    expect(card).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.queryByRole("dialog", { name: "Edit request" }),
    ).not.toBeInTheDocument();
    expect(card).not.toHaveAttribute("aria-description");
    expect(card).not.toHaveAttribute("title", "Long-press to edit");
  });

  it("keeps the TV progress-chip hold editor", async () => {
    const show = feedItem("tv");
    show.payload.members = [
      { id: "andre", name: "Andre", season: 1, episode: 2 },
    ];
    vi.useFakeTimers();
    try {
      renderFeed("/", [show]);
      await act(async () => {});
      fireEvent.click(screen.getByText("Severance"));
      const seasonChip = screen.getByTitle(
        "Tap to advance season; long-press to edit",
      );

      fireEvent.pointerDown(seasonChip);
      act(() => vi.advanceTimersByTime(1000));

      expect(
        screen.getByRole("spinbutton", { name: "Set Andre's season" }),
      ).toHaveValue(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not expose editing to non-creators or archived module owners", async () => {
    const nonOwner = feedItem("requests");
    nonOwner.payload.requesterId = "kayla";
    renderFeed("/", [nonOwner, feedItem("checklists", "archived", true)]);
    const user = userEvent.setup();

    await screen.findByText("Pick up milk");
    const nonOwnerCard = cardForText("Pick up milk");
    await user.click(screen.getByText("Pick up milk"));
    expect(
      within(nonOwnerCard).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Archived \(1\)/ }));
    const archivedCard = cardForText("Kitchen reset");
    await user.click(screen.getByText("Kitchen reset"));
    expect(
      within(archivedCard).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
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
    const allTab = screen.getByRole("tab", { name: /^All/ });
    const eventsTab = screen.getByRole("tab", { name: /^Events/ });
    const scroller = document.querySelector(
      "[data-feed-category-scroller]",
    );
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 200 },
      scrollWidth: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    });
    Object.defineProperties(allTab, {
      offsetLeft: { configurable: true, value: 0 },
      offsetWidth: { configurable: true, value: 60 },
    });
    Object.defineProperties(eventsTab, {
      offsetLeft: { configurable: true, value: 180 },
      offsetWidth: { configurable: true, value: 80 },
    });
    document.querySelector(
      "[data-feed-swipe-phase]",
    ).parentElement.getBoundingClientRect = vi.fn(() => ({ width: 184 }));
    fireEvent.pointerDown(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 120,
    });
    fireEvent.pointerMove(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 150,
      clientY: 121,
    });
    fireEvent.pointerMove(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 80,
      clientY: 320,
    });
    expect(
      document.querySelector('[data-feed-panel-type="all"]'),
    ).toHaveStyle({ transform: "translate3d(-85px, 0, 0)" });
    const incomingPanel = document.querySelector(
      '[data-feed-panel-type="events"]',
    );
    expect(incomingPanel).toHaveStyle({
      transform: "translate3d(calc(100% + 16px + -85px), 0, 0)",
    });
    expect(within(incomingPanel).getByText("Movie night")).toBeInTheDocument();
    expect(
      document.querySelector('[data-feed-panel-type="requests"]'),
    ).not.toBeInTheDocument();
    fireEvent.pointerUp(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 80,
      clientY: 320,
    });
    fireEvent.transitionEnd(
      document.querySelector('[data-feed-panel-type="all"]'),
      { propertyName: "transform" },
    );

    expect(
      await screen.findByRole("tab", { name: /^Events/, selected: true }),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-feed-panel-type="events"]'),
    ).toBe(incomingPanel);
    expect(scroller.scrollLeft).toBe(120);
  });

  it("switches filters when swiping on a native Book Club header button", async () => {
    renderFeed(
      "/",
      [feedItem("tv"), feedItem("book-club")],
      { showBookClub: true },
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole("tab", { name: /^Book Club/ }));
    const header = screen.getByRole("button", {
      name: /The Left Hand of Darkness/,
      expanded: false,
    });
    document.querySelector(
      "[data-feed-swipe-phase]",
    ).parentElement.getBoundingClientRect = vi.fn(() => ({ width: 184 }));

    fireEvent.pointerDown(header, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 80,
      clientY: 120,
    });
    fireEvent.pointerMove(header, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 82,
      clientY: 150,
    });
    fireEvent.pointerUp(header, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 82,
      clientY: 150,
    });
    expect(
      screen.getByRole("tab", { name: /^Book Club/, selected: true }),
    ).toBeInTheDocument();

    fireEvent.pointerDown(header, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 80,
      clientY: 120,
    });
    fireEvent.pointerMove(header, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 110,
      clientY: 121,
    });
    fireEvent.pointerMove(header, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 180,
      clientY: 124,
    });
    expect(
      document.querySelector('[data-feed-panel-type="book-club"]'),
    ).toHaveStyle({ transform: "translate3d(85px, 0, 0)" });
    fireEvent.pointerUp(header, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 180,
      clientY: 124,
    });
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    fireEvent.transitionEnd(
      document.querySelector('[data-feed-panel-type="book-club"]'),
      { propertyName: "transform" },
    );

    expect(
      await screen.findByRole("tab", { name: /^TV/, selected: true }),
    ).toBeInTheDocument();
  });

  it("finishes a horizontally locked swipe from its last position on pointer cancel", async () => {
    renderFeed("/", [feedItem("events")]);

    await screen.findByText("Movie night");
    const card = cardForText("Movie night");
    document.querySelector(
      "[data-feed-swipe-phase]",
    ).parentElement.getBoundingClientRect = vi.fn(() => ({ width: 184 }));
    fireEvent.pointerDown(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 120,
    });
    fireEvent.pointerMove(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 150,
      clientY: 121,
    });
    fireEvent.pointerMove(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 80,
      clientY: 320,
    });
    fireEvent.pointerCancel(card, {
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.transitionEnd(
      document.querySelector('[data-feed-panel-type="all"]'),
      { propertyName: "transform" },
    );

    expect(
      await screen.findByRole("tab", { name: /^Events/, selected: true }),
    ).toBeInTheDocument();
  });

  it("does not move the page when categories change before the feed is reached", async () => {
    renderFeed("/", [feedItem("events")]);
    const user = userEvent.setup();

    await screen.findByText("Movie night");
    const shell = document.querySelector("[data-feed-shell]");
    shell.getBoundingClientRect = vi.fn(() => feedShellRectAt(300));
    setWindowScrollY(100);
    window.scrollTo = vi.fn();

    await user.click(screen.getByRole("tab", { name: /^Events/ }));

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("opens unseen categories at the feed top and restores prior positions", async () => {
    renderFeed("/", [feedItem("events")]);
    const user = userEvent.setup();

    await screen.findByText("Movie night");
    const shell = document.querySelector("[data-feed-shell]");
    shell.getBoundingClientRect = vi.fn(() => feedShellRectAt(300));
    Object.defineProperties(document.documentElement, {
      scrollHeight: { configurable: true, value: 2400 },
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    window.scrollTo = vi.fn(({ top }) => setWindowScrollY(top));

    setWindowScrollY(620);
    await user.click(screen.getByRole("tab", { name: /^Events/ }));
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 300,
      left: 0,
      behavior: "auto",
    });

    setWindowScrollY(480);
    await user.click(screen.getByRole("tab", { name: /^All/ }));
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 620,
      left: 0,
      behavior: "auto",
    });

    await user.click(screen.getByRole("tab", { name: /^Events/ }));
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 480,
      left: 0,
      behavior: "auto",
    });
  });

  it("pre-aligns and promotes the saved category without replacing its panel", async () => {
    renderFeed("/", [feedItem("events")]);
    const user = userEvent.setup();

    await screen.findByText("Movie night");
    const shell = document.querySelector("[data-feed-shell]");
    shell.getBoundingClientRect = vi.fn(() => feedShellRectAt(300));
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 2400,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    window.scrollTo = vi.fn(({ top }) => setWindowScrollY(top));

    setWindowScrollY(620);
    await user.click(screen.getByRole("tab", { name: /^Events/ }));
    setWindowScrollY(480);
    fireEvent.scroll(window);
    const header = document.querySelector("[data-feed-sticky-header]");
    await waitFor(() => expect(header).toHaveAttribute("data-feed-pinned"));

    const card = cardForText("Movie night");
    document.querySelector(
      "[data-feed-swipe-phase]",
    ).parentElement.getBoundingClientRect = vi.fn(() => ({ width: 184 }));
    fireEvent.pointerDown(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 80,
      clientY: 120,
    });
    fireEvent.pointerMove(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 110,
      clientY: 121,
    });
    setWindowScrollY(297);
    fireEvent.scroll(window);
    expect(header).toHaveAttribute("data-feed-pinned");
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 480,
      left: 0,
      behavior: "auto",
    });
    fireEvent.pointerMove(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 500,
    });

    const incomingAll = document.querySelector(
      '[data-feed-panel-type="all"]',
    );
    expect(incomingAll.style.transform).toBe(
      "translate3d(calc(-100% - 16px + 85px), -140px, 0)",
    );

    fireEvent.pointerUp(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 500,
    });

    await screen.findByRole("tab", { name: /^All/, selected: true });
    expect(document.querySelector('[data-feed-panel-type="all"]')).toBe(
      incomingAll,
    );
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 620,
      left: 0,
      behavior: "auto",
    });
  });

  it("clears every saved category position when the feed title unpins", async () => {
    renderFeed("/", [feedItem("events")]);
    const user = userEvent.setup();

    await screen.findByText("Movie night");
    const shell = document.querySelector("[data-feed-shell]");
    const header = document.querySelector("[data-feed-sticky-header]");
    shell.getBoundingClientRect = vi.fn(() => feedShellRectAt(300));
    header.getBoundingClientRect = vi.fn(() => ({
      ...feedShellRectAt(300),
      bottom: 400 - window.scrollY,
      height: 100,
    }));
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 2400,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    window.scrollTo = vi.fn(({ top }) => setWindowScrollY(top));

    setWindowScrollY(620);
    fireEvent.scroll(window);
    await waitFor(() => expect(header).toHaveAttribute("data-feed-pinned"));
    await user.click(screen.getByRole("tab", { name: /^Events/ }));
    setWindowScrollY(480);
    await user.click(screen.getByRole("tab", { name: /^All/ }));

    setWindowScrollY(100);
    fireEvent.scroll(window);
    await waitFor(() =>
      expect(header).not.toHaveAttribute("data-feed-pinned"),
    );
    window.scrollTo.mockClear();
    await user.click(screen.getByRole("tab", { name: /^Events/ }));

    const eventsPanel = document.querySelector(
      '[data-feed-panel-type="events"]',
    );
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(eventsPanel).toHaveStyle({
      transform: "translate3d(0px, 0, 0)",
    });

    setWindowScrollY(480);
    fireEvent.scroll(window);
    await waitFor(() => expect(header).toHaveAttribute("data-feed-pinned"));
    await user.click(screen.getByRole("tab", { name: /^All/ }));
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 300,
      left: 0,
      behavior: "auto",
    });
  });

  it("drops a stale saved offset when its category becomes empty", async () => {
    renderFeed("/", [feedItem("events")]);
    const user = userEvent.setup();

    await screen.findByText("Movie night");
    const shell = document.querySelector("[data-feed-shell]");
    shell.getBoundingClientRect = vi.fn(() => feedShellRectAt(300));
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 2400,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    window.scrollTo = vi.fn(({ top }) => setWindowScrollY(top));

    setWindowScrollY(620);
    await user.click(screen.getByRole("tab", { name: /^Events/ }));
    setWindowScrollY(480);
    await user.click(screen.getByRole("tab", { name: /^All/ }));

    getFeed.mockResolvedValue([]);
    fireEvent.focus(window);
    await waitFor(() =>
      expect(screen.queryByText("Movie night")).not.toBeInTheDocument(),
    );
    setWindowScrollY(100);

    const feedMain = document.querySelector(
      "[data-feed-swipe-phase]",
    ).parentElement;
    feedMain.getBoundingClientRect = vi.fn(() => ({ width: 184 }));
    fireEvent.pointerDown(feedMain, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 120,
    });
    fireEvent.pointerMove(feedMain, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 80,
      clientY: 124,
    });

    const incomingEvents = document.querySelector(
      '[data-feed-panel-type="events"]',
    );
    expect(incomingEvents).toHaveStyle({
      transform: "translate3d(calc(100% + 16px + -85px), 0, 0)",
    });
    expect(
      within(incomingEvents).getByText("No active modules here yet."),
    ).toBeInTheDocument();
  });

  it("moves the category underline with an in-progress swipe", async () => {
    renderFeed("/", [feedItem("events"), feedItem("requests")]);

    await screen.findByText("Movie night");
    const tabList = screen.getByRole("tablist", { name: "Feed categories" });
    const allContent = within(
      screen.getByRole("tab", { name: /^All/ }),
    ).getByText("All").parentElement;
    const eventsContent = within(
      screen.getByRole("tab", { name: /^Events/ }),
    ).getByText("Events").parentElement;
    const rect = (left, width) => ({
      left,
      right: left + width,
      top: 0,
      bottom: 20,
      x: left,
      y: 0,
      width,
      height: 20,
      toJSON: () => ({}),
    });
    tabList.getBoundingClientRect = vi.fn(() => rect(0, 500));
    allContent.getBoundingClientRect = vi.fn(() => rect(10, 40));
    eventsContent.getBoundingClientRect = vi.fn(() => rect(110, 70));
    fireEvent(window, new Event("resize"));

    const indicator = document.querySelector(
      "[data-feed-category-indicator]",
    );
    await waitFor(() =>
      expect(indicator).toHaveStyle({
        transform: "translate3d(10px, 0, 0)",
        width: "40px",
      }),
    );

    const feedMain = document.querySelector(
      "[data-feed-swipe-phase]",
    ).parentElement;
    feedMain.getBoundingClientRect = vi.fn(() => rect(0, 184));
    const card = cardForText("Movie night");
    fireEvent.pointerDown(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 120,
    });
    fireEvent.pointerMove(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 80,
      clientY: 124,
    });

    expect(indicator).toHaveStyle({
      transform: "translate3d(52.5px, 0, 0)",
      width: "52.75px",
    });
    fireEvent.pointerUp(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 150,
      clientY: 124,
    });
    expect(indicator).toHaveStyle({
      transform: "translate3d(10px, 0, 0)",
      width: "40px",
    });
  });

  it.each([
    ["forward", -100, /^Book Club/, 560, 100, 379.875],
    ["backward", 100, /^Polls/, 330, 70, 322.5],
  ])(
    "tracks a %s swipe between the centered category positions",
    async (_direction, deltaX, adjacentName, adjacentOffset, adjacentWidth, expectedLeft) => {
      renderFeed(
        "/?module=tv",
        [feedItem("events"), feedItem("tv"), feedItem("book-club")],
        { showBookClub: true },
      );

      const activeTab = await screen.findByRole("tab", {
        name: /^TV/,
        selected: true,
      });
      const adjacentTab = screen.getByRole("tab", { name: adjacentName });
      const swipeTarget = document.querySelector(
        "[data-feed-swipe-phase]",
      ).parentElement;
      const scroller = document.querySelector(
        "[data-feed-category-scroller]",
      );
      Object.defineProperties(scroller, {
        clientWidth: { configurable: true, value: 200 },
        scrollWidth: { configurable: true, value: 600 },
        scrollLeft: { configurable: true, value: 365, writable: true },
      });
      Object.defineProperties(activeTab, {
        offsetLeft: { configurable: true, value: 430 },
        offsetWidth: { configurable: true, value: 70 },
      });
      Object.defineProperties(adjacentTab, {
        offsetLeft: { configurable: true, value: adjacentOffset },
        offsetWidth: { configurable: true, value: adjacentWidth },
      });
      swipeTarget.getBoundingClientRect = vi.fn(() => ({ width: 184 }));

      fireEvent.pointerDown(swipeTarget, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 180,
        clientY: 120,
      });
      fireEvent.pointerMove(swipeTarget, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 180 + deltaX,
        clientY: 121,
      });

      expect(scroller.scrollLeft).toBeCloseTo(expectedLeft, 3);
    },
  );

  it.each([
    ["first", "/", {}, /^All/, "Movie night", 0, 60, 100, 0],
    [
      "last",
      "/?module=book-club",
      { showBookClub: true },
      /^Book Club/,
      "The Left Hand of Darkness",
      560,
      100,
      -100,
      400,
    ],
  ])(
    "keeps the %s category edge-anchored during an outward swipe",
    async (
      _edge,
      initialUrl,
      props,
      activeTabName,
      cardText,
      tabOffset,
      tabWidth,
      deltaX,
      expectedLeft,
    ) => {
      renderFeed(
        initialUrl,
        [feedItem("events"), feedItem("tv"), feedItem("book-club")],
        props,
      );

      const activeTab = await screen.findByRole("tab", {
        name: activeTabName,
        selected: true,
      });
      await screen.findByText(cardText);
      const swipeTarget = document.querySelector(
        "[data-feed-swipe-phase]",
      ).parentElement;
      const scroller = document.querySelector(
        "[data-feed-category-scroller]",
      );
      Object.defineProperties(scroller, {
        clientWidth: { configurable: true, value: 200 },
        scrollWidth: { configurable: true, value: 600 },
        scrollLeft: { configurable: true, value: 250, writable: true },
      });
      Object.defineProperties(activeTab, {
        offsetLeft: { configurable: true, value: tabOffset },
        offsetWidth: { configurable: true, value: tabWidth },
      });
      swipeTarget.getBoundingClientRect = vi.fn(() => ({ width: 184 }));

      fireEvent.pointerDown(swipeTarget, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 180,
        clientY: 120,
      });
      fireEvent.pointerMove(swipeTarget, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 180 + deltaX,
        clientY: 121,
      });

      expect(scroller.scrollLeft).toBe(expectedLeft);
    },
  );

  it("does not reposition categories before horizontal swipe intent", async () => {
    renderFeed("/", [feedItem("events")]);

    await screen.findByText("Movie night");
    const card = cardForText("Movie night");
    const scroller = document.querySelector(
      "[data-feed-category-scroller]",
    );
    scroller.scrollTo = vi.fn();
    fireEvent.pointerDown(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 120,
    });
    expect(scroller.scrollTo).not.toHaveBeenCalled();

    fireEvent.pointerMove(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 178,
      clientY: 160,
    });
    fireEvent.pointerMove(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 80,
      clientY: 162,
    });
    expect(scroller.scrollTo).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-feed-swipe-phase="idle"]'),
    ).toBeInTheDocument();
  });

  it("snaps an incomplete swipe back while keeping the adjacent page visible", async () => {
    renderFeed("/", [feedItem("events"), feedItem("requests")]);

    await screen.findByText("Movie night");
    const card = cardForText("Movie night");
    const allTab = screen.getByRole("tab", { name: /^All/ });
    const eventsTab = screen.getByRole("tab", { name: /^Events/ });
    const scroller = document.querySelector(
      "[data-feed-category-scroller]",
    );
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 200 },
      scrollWidth: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    });
    Object.defineProperties(allTab, {
      offsetLeft: { configurable: true, value: 0 },
      offsetWidth: { configurable: true, value: 60 },
    });
    Object.defineProperties(eventsTab, {
      offsetLeft: { configurable: true, value: 180 },
      offsetWidth: { configurable: true, value: 80 },
    });
    document.querySelector(
      "[data-feed-swipe-phase]",
    ).parentElement.getBoundingClientRect = vi.fn(() => ({ width: 184 }));
    fireEvent.pointerDown(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 120,
    });
    fireEvent.pointerMove(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 150,
      clientY: 123,
    });
    expect(scroller.scrollLeft).toBeCloseTo(15.3, 3);
    fireEvent.pointerMove(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 150,
      clientY: 300,
    });
    expect(scroller.scrollLeft).toBeCloseTo(15.3, 3);

    const incomingPanel = document.querySelector(
      '[data-feed-panel-type="events"]',
    );
    expect(within(incomingPanel).getByText("Movie night")).toBeInTheDocument();
    fireEvent.pointerUp(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 150,
      clientY: 300,
    });

    const activePanel = document.querySelector('[data-feed-panel-type="all"]');
    expect(activePanel).toHaveStyle({
      transform: "translate3d(0px, 0, 0)",
    });
    fireEvent.transitionEnd(activePanel, { propertyName: "transform" });
    await waitFor(() =>
      expect(
        document.querySelector('[data-feed-swipe-phase="idle"]'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("tab", { name: /^All/, selected: true })).toBeInTheDocument();
    await waitFor(() => expect(scroller.scrollLeft).toBe(0));
  });

  it("resists outward swipes at the first category without wrapping", async () => {
    renderFeed("/", [feedItem("events")]);

    await screen.findByText("Movie night");
    const card = cardForText("Movie night");
    fireEvent.pointerDown(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 80,
      clientY: 120,
    });
    fireEvent.pointerMove(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 124,
    });

    expect(document.querySelector('[data-feed-panel-type="all"]')).toHaveStyle({
      transform: "translate3d(18px, 0, 0)",
    });
    expect(
      document.querySelector('[data-feed-panel-type="tv"]'),
    ).not.toBeInTheDocument();
    fireEvent.pointerUp(card, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 124,
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-feed-swipe-phase="idle"]'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("tab", { name: /^All/, selected: true })).toBeInTheDocument();
  });

  it("supports arrow-key navigation across category tabs", async () => {
    renderFeed("/", [feedItem("events"), feedItem("requests")]);

    await screen.findByText("Movie night");
    const allTab = screen.getByRole("tab", { name: /^All/ });
    allTab.focus();
    fireEvent.keyDown(allTab, { key: "ArrowRight" });

    const eventsTab = screen.getByRole("tab", {
      name: /^Events/,
      selected: true,
    });
    expect(eventsTab).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      eventsTab.id,
    );
  });

  it("supports touch drag ordering in filter edit mode", async () => {
    renderFeed("/", [feedItem("events"), feedItem("requests")]);
    const user = userEvent.setup();

    await screen.findByText("Movie night");
    const moduleNav = await openModuleNav(user);
    await user.click(
      within(moduleNav).getByRole("button", { name: "Edit" }),
    );
    const requestDropTarget = document.querySelector(
      '[data-module-drop-type="requests"]',
    );
    const rowOrder = () =>
      Array.from(document.querySelectorAll("[data-module-drop-type]")).map(
        (row) => row.getAttribute("data-module-drop-type"),
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
    fireEvent.pointerMove(eventsHandle, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 230,
      clientY: 188,
    });
    expect(rowOrder()).toEqual(["requests", "events", "checklists", "polls", "tv"]);
    fireEvent.pointerUp(eventsHandle, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 230,
      clientY: 188,
    });

    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    const card = cardForText("Movie night");
    fireEvent.pointerDown(card, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 180,
      clientY: 120,
    });
    fireEvent.pointerMove(card, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 80,
      clientY: 126,
    });
    fireEvent.pointerUp(card, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 80,
      clientY: 126,
    });

    expect(
      await screen.findByRole("tab", { name: /^Requests/, selected: true }),
    ).toBeInTheDocument();
  });

  it("preserves an open edit draft across polling and saves through the generic API", async () => {
    const module = feedItem("requests");
    renderFeed("/", [module]);
    const user = userEvent.setup();

    await user.click(await screen.findByText("Pick up milk"));
    await user.click(
      within(cardForText("Pick up milk")).getByRole("button", { name: "Edit" }),
    );
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

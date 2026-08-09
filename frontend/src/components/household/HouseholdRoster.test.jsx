import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import HouseholdRoster from "./HouseholdRoster.jsx";
import {
  notifyRoommatesToUpdateStatus,
  pokeRoommate,
  updateStatus,
} from "../../api/roommates.js";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({
    user: { id: "andre", name: "Andre", hasGroup: true, activeGroupId: "shire" },
  }),
}));

vi.mock("../../api/roommates.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    updateStatus: vi.fn(),
    notifyRoommatesToUpdateStatus: vi.fn(),
    pokeRoommate: vi.fn(),
  };
});

function roommate(id, name, overrides = {}) {
  return {
    id,
    name,
    status: "busy",
    statusText: "",
    statusUpdatedAt: null,
    ...overrides,
  };
}

const ROSTER = [
  roommate("andre", "Andre"),
  roommate("kayla", "Kayla"),
  roommate("sheryl", "Sheryl"),
];

function LocationProbe() {
  const { search } = useLocation();
  return <div data-testid="search">{search}</div>;
}

function renderRoster(props = {}, { route = "/" } = {}) {
  const handlers = {
    onShareJam: vi.fn(),
    onRoommatesChange: vi.fn(),
    onError: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={[route]}>
      <HouseholdRoster
        roommates={ROSTER}
        groupName="Yorkshire"
        {...handlers}
        {...props}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
  return handlers;
}

describe("HouseholdRoster", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("splits you out of the roster without duplicating yourself", () => {
    renderRoster();

    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getAllByText("Andre")).toHaveLength(1);
    expect(screen.getByText("Kayla")).toBeInTheDocument();
    expect(screen.getByText("Sheryl")).toBeInTheDocument();
  });

  it("renders the header and grid even when you are not in the roster", () => {
    renderRoster({ roommates: [roommate("kayla", "Kayla")] });

    expect(screen.queryByRole("button", { name: "Edit status" })).toBeNull();
    expect(screen.getByText("Yorkshire")).toBeInTheDocument();
    expect(screen.getByText("Kayla")).toBeInTheDocument();
  });

  it("falls back to a generic group title when the name is missing or blank", () => {
    renderRoster({ groupName: undefined });
    expect(screen.getByText("Your group")).toBeInTheDocument();

    cleanup();
    // `||` rather than `??`, so an empty name falls back too.
    renderRoster({ groupName: "" });
    expect(screen.getByText("Your group")).toBeInTheDocument();
  });

  it("notifies the household and re-enables the button afterwards", async () => {
    notifyRoommatesToUpdateStatus.mockResolvedValue(undefined);
    const { onError } = renderRoster();
    const button = screen.getByRole("button", { name: "Notify all to update" });

    await userEvent.click(button);

    await waitFor(() =>
      expect(notifyRoommatesToUpdateStatus).toHaveBeenCalledWith("andre"),
    );
    expect(onError).toHaveBeenCalledWith("");
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("reports a failed notify upward rather than rendering its own box", async () => {
    notifyRoommatesToUpdateStatus.mockRejectedValue(new Error("nope"));
    const { onError } = renderRoster();

    await userEvent.click(
      screen.getByRole("button", { name: "Notify all to update" }),
    );

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Could not notify the shire. Try again."),
    );
    expect(
      screen.queryByText("Could not notify the shire. Try again."),
    ).toBeNull();
  });

  it("places the enabled Spotify action after Notify and reflects Jam state", async () => {
    const { onShareJam } = renderRoster({
      showSpotifyJam: true,
      hasJam: true,
    });
    const header = screen.getByText("Yorkshire").parentElement;
    const actions = within(header).getAllByRole("button");

    expect(actions.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Notify all to update",
      "Replace Spotify Jam",
    ]);
    await userEvent.click(actions[1]);
    expect(onShareJam).toHaveBeenCalledOnce();

    cleanup();
    renderRoster({ showSpotifyJam: true, hasJam: false });
    expect(
      screen.getByRole("button", { name: "Share Spotify Jam" }),
    ).toBeInTheDocument();
  });

  it("saves a status, hands the returned roster up, and closes the editor", async () => {
    const updated = [...ROSTER, roommate("ting", "Ting")];
    updateStatus.mockResolvedValue(updated);
    const { onRoommatesChange } = renderRoster();

    await userEvent.click(screen.getByRole("button", { name: "Edit status" }));
    await userEvent.type(
      screen.getByPlaceholderText("Add a note (optional)…"),
      "  back at 7  ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // The note is trimmed before it reaches the API.
    await waitFor(() =>
      expect(updateStatus).toHaveBeenCalledWith("andre", "busy", "back at 7"),
    );
    expect(onRoommatesChange).toHaveBeenCalledWith(updated);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
  });

  it("keeps the editor open when a save fails", async () => {
    updateStatus.mockRejectedValue(new Error("nope"));
    const { onError, onRoommatesChange } = renderRoster();

    await userEvent.click(screen.getByRole("button", { name: "Edit status" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Could not save your status. Try again."),
    );
    expect(onRoommatesChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("pokes a roommate through the card's modal", async () => {
    pokeRoommate.mockResolvedValue(undefined);
    renderRoster();

    await userEvent.click(screen.getByRole("button", { name: /Kayla/ }));
    await userEvent.click(screen.getByRole("button", { name: "👉 Poke" }));

    await waitFor(() => expect(pokeRoommate).toHaveBeenCalledWith("kayla", "andre"));
    expect(await screen.findByText("Poked once")).toBeInTheDocument();
  });

  it("opens the editor from a poke deep link and consumes the param", async () => {
    renderRoster({}, { route: "/?updateStatus=1" });

    // The editor opens on mount, and ?updateStatus is stripped so a later
    // re-render does not reopen it.
    expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("search").textContent).not.toContain("updateStatus"),
    );
  });
});

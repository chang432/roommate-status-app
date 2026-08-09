import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFeed } from "../api/feed.js";
import useGroupModules from "./useGroupModules.js";

vi.mock("../api/feed.js", () => ({ getFeed: vi.fn() }));

function feedItem(id, sortAt) {
  return {
    id,
    type: "events",
    createdAt: sortAt,
    updatedAt: sortAt,
    sortAt,
    isArchived: false,
    payload: { id, text: id },
  };
}

function Harness({ groupId, enabledModuleIds = "all" }) {
  const { modules, loading, error, refreshModules } = useGroupModules(
    "andre",
    groupId,
    enabledModuleIds,
  );
  return (
    <>
      <output>
        {loading ? "loading" : modules.map((module) => module.id).join(",")}
        {error}
      </output>
      <button type="button" onClick={refreshModules}>Refresh</button>
    </>
  );
}

describe("useGroupModules", () => {
  afterEach(() => vi.clearAllMocks());

  it("loads and normalizes the unified feed newest first", async () => {
    getFeed.mockResolvedValue([feedItem("older", 1), feedItem("newer", 2)]);
    render(<Harness groupId="shire" />);

    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findByText("newer,older")).toBeInTheDocument();
    expect(getFeed).toHaveBeenCalledWith("andre", "all", "shire");
  });

  it("does not let a slower previous group replace the active group", async () => {
    let resolveShire;
    let resolveYorkshire;
    getFeed.mockImplementation((_userId, _type, groupId) =>
      new Promise((resolve) => {
        if (groupId === "shire") resolveShire = resolve;
        else resolveYorkshire = resolve;
      }),
    );

    const view = render(<Harness groupId="shire" />);
    view.rerender(<Harness groupId="yorkshire" />);
    resolveYorkshire([feedItem("yorkshire-event", 2)]);
    expect(
      await screen.findByText("yorkshire-event"),
    ).toBeInTheDocument();

    resolveShire([feedItem("stale-shire-event", 3)]);
    await waitFor(() =>
      expect(screen.queryByText("stale-shire-event")).not.toBeInTheDocument(),
    );
  });

  it("waits for enabled modules and skips an explicitly empty group", async () => {
    const view = render(
      <Harness groupId="shire" enabledModuleIds={null} />,
    );
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(getFeed).not.toHaveBeenCalled();

    view.rerender(<Harness groupId="shire" enabledModuleIds={[]} />);
    await waitFor(() => expect(screen.queryByText("loading")).not.toBeInTheDocument());
    expect(getFeed).not.toHaveBeenCalled();
  });

  it("requests only the enabled module types", async () => {
    getFeed.mockResolvedValue([]);
    render(
      <Harness
        groupId="shire"
        enabledModuleIds={["tv", "events", "spotify"]}
      />,
    );

    await waitFor(() =>
      expect(getFeed).toHaveBeenCalledWith(
        "andre",
        ["events", "spotify", "tv"],
        "shire",
      ),
    );
  });

  it("coalesces overlapping refreshes and performs one trailing request", async () => {
    let resolveFirst;
    getFeed
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockResolvedValueOnce([]);
    render(
      <Harness groupId="shire" enabledModuleIds={["events"]} />,
    );
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(1));

    const refreshButton = screen.getAllByRole("button", { name: "Refresh" }).at(-1);
    fireEvent.click(refreshButton);
    fireEvent.click(refreshButton);
    expect(getFeed).toHaveBeenCalledTimes(1);

    resolveFirst([]);
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(2));
  });
});

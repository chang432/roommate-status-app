import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as countersApi from "../../api/counters.js";
import CounterFeature from "./CounterFeature.jsx";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/counters.js", () => ({
  addCounterEntry: vi.fn(),
  archiveCounter: vi.fn(),
  deleteCounter: vi.fn(),
  deleteCounterEntry: vi.fn(),
  getCounter: vi.fn(),
  restoreCounter: vi.fn(),
  updateCounterEntry: vi.fn(),
}));

const COUNTER = {
  id: "counter-1",
  title: "Plants watered",
  mode: "manual",
  currentValue: 2,
  createdById: "andre",
  createdBy: "Andre",
  createdAt: 1,
  updatedAt: 1,
  isArchived: false,
};

const DETAIL = {
  counter: COUNTER,
  entries: [{
    id: "entry-1",
    kind: "baseline",
    value: 2,
    resultingValue: 2,
    occurredAt: 1,
    createdAt: 1,
    createdById: "andre",
    createdBy: "Andre",
    note: "Starting point",
  }],
  nextCursor: null,
};

function renderCounter(overrides = {}) {
  const onCountersChange = vi.fn().mockResolvedValue();
  render(<CounterFeature counter={{ ...COUNTER, ...overrides }} moduleTag={<span>Counters</span>} onCountersChange={onCountersChange} onEdit={vi.fn()} />);
  return { onCountersChange };
}

describe("CounterFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countersApi.getCounter.mockResolvedValue(DETAIL);
    Object.values(countersApi).forEach((mock) => {
      if (mock !== countersApi.getCounter) mock.mockResolvedValue({ counter: COUNTER });
    });
  });
  afterEach(() => cleanup());

  it("loads history only after expansion and increments the shared count", async () => {
    const { onCountersChange } = renderCounter();
    expect(countersApi.getCounter).not.toHaveBeenCalled();
    const summary = screen.getByRole("button", { name: /Counters Plants watered/ });
    await userEvent.click(summary);
    await waitFor(() => expect(countersApi.getCounter).toHaveBeenCalledWith("counter-1", "andre", ""));
    expect(await screen.findByText("Started at 2")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Increase Plants watered" }));
    await waitFor(() => expect(countersApi.addCounterEntry).toHaveBeenCalledWith("counter-1", {
      userId: "andre",
      delta: 1,
      note: "",
    }));
    expect(onCountersChange).toHaveBeenCalled();
  });

  it("lets non-creators archive but hides creator-only edit and delete actions", async () => {
    renderCounter({ createdById: "kayla" });
    await userEvent.click(screen.getByRole("button", { name: /Counters Plants watered/ }));
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(countersApi.archiveCounter).toHaveBeenCalledWith("counter-1", "andre"));
  });

  it("renders automatic counters only in completed days", async () => {
    const lastIncidentAt = Date.now() - (2 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
    countersApi.getCounter.mockResolvedValueOnce({
      counter: { ...COUNTER, mode: "automatic", lastIncidentAt, currentValue: 2 },
      entries: [{ ...DETAIL.entries[0], kind: "incident", occurredAt: lastIncidentAt }],
      nextCursor: null,
    });
    renderCounter({ mode: "automatic", lastIncidentAt, currentValue: 2 });
    expect(screen.getByRole("button", { name: /Counters Plants watered/ })).toHaveTextContent("2 days");
    await userEvent.click(screen.getByRole("button", { name: /Counters Plants watered/ }));
    expect(await screen.findByRole("button", { name: "Log incident" })).toBeInTheDocument();
  });
});

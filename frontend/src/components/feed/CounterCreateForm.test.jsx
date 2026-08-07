import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCounter } from "../../api/counters.js";
import CounterCreateForm from "./CounterCreateForm.jsx";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/counters.js", () => ({ createCounter: vi.fn() }));

function renderForm() {
  const props = { onCountersChange: vi.fn(), onSuccess: vi.fn(), onCancel: vi.fn() };
  render(<CounterCreateForm {...props} />);
  return props;
}

describe("CounterCreateForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCounter.mockResolvedValue({ counter: {} });
  });
  afterEach(() => cleanup());

  it("creates a days-since counter with a starting incident", async () => {
    const { onCountersChange, onSuccess } = renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Counter name"), "Days since a spill");
    await user.type(screen.getByLabelText(/Starting note/), "Clean slate");
    await user.click(screen.getByRole("button", { name: "Create counter" }));

    await waitFor(() => expect(createCounter).toHaveBeenCalledWith(expect.objectContaining({
      title: "Days since a spill",
      mode: "automatic",
      createdById: "andre",
      note: "Clean slate",
      occurredAt: expect.any(Number),
    })));
    expect(onCountersChange).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("switches to a non-negative manual starting value", async () => {
    renderForm();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Manual count/));
    await user.type(screen.getByLabelText("Counter name"), "Plants watered");
    await user.clear(screen.getByLabelText("Starting value"));
    await user.type(screen.getByLabelText("Starting value"), "4");
    await user.click(screen.getByRole("button", { name: "Create counter" }));

    await waitFor(() => expect(createCounter).toHaveBeenCalledWith(expect.objectContaining({
      mode: "manual",
      initialValue: 4,
    })));
  });
});

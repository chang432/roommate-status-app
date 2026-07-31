import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChecklist } from "../../api/checklists.js";
import ChecklistCreateForm from "./ChecklistCreateForm.jsx";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/checklists.js", () => ({
  createChecklist: vi.fn(),
}));

describe("ChecklistCreateForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createChecklist.mockResolvedValue([]);
  });
  afterEach(() => cleanup());

  it("preserves checklist creation through the shared item editor", async () => {
    const onChecklistsChange = vi.fn();
    const onSuccess = vi.fn();
    render(
      <ChecklistCreateForm
        onChecklistsChange={onChecklistsChange}
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Checklist title"), "Kitchen reset");
    await user.type(screen.getByLabelText("Checklist item 1"), "Counters");
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.type(screen.getByLabelText("Checklist item 2"), "Floor");
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() =>
      expect(createChecklist).toHaveBeenCalledWith(
        "Kitchen reset",
        "andre",
        ["Counters", "Floor"],
      ),
    );
    expect(onChecklistsChange).toHaveBeenCalledWith([]);
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});

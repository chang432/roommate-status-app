import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChecklistFeature from "./ChecklistFeature.jsx";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/checklists.js", () => ({
  addChecklistItem: vi.fn(),
  archiveChecklist: vi.fn(),
  deleteChecklist: vi.fn(),
  deleteChecklistItem: vi.fn(),
  notifyChecklist: vi.fn(),
  restoreChecklist: vi.fn(),
  toggleChecklistItem: vi.fn(),
  updateChecklistItem: vi.fn(),
}));

const BASE_CHECKLIST = {
  id: "checklist-1",
  title: "Kitchen reset",
  createdBy: "Andre",
  createdById: "andre",
  createdAt: 1,
  isArchived: false,
};

function item(id, checkedByIds = []) {
  return {
    id,
    text: `Item ${id}`,
    checkedByIds,
    checkedBy: checkedByIds.map((personId) => ({
      id: personId,
      name: personId,
    })),
  };
}

function renderChecklist(items) {
  render(
    <ChecklistFeature
      checklist={{ ...BASE_CHECKLIST, items }}
      onChecklistsChange={vi.fn()}
      moduleTag={<span>Checklists</span>}
      onEdit={vi.fn()}
    />,
  );
}

describe("ChecklistFeature", () => {
  afterEach(() => cleanup());

  it.each([
    ["No items yet", []],
    ["0 of 2 complete", [item("one"), item("two")]],
    ["1 of 2 complete", [item("one", ["andre", "kayla"]), item("two")]],
    ["2 of 2 complete", [item("one", ["andre"]), item("two", ["kayla"])]],
  ])("shows %s in the creator metadata row", (progress, items) => {
    renderChecklist(items);

    const metadata = screen.getByText(new RegExp(`Andre · .* · ${progress}$`));
    expect(metadata).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Checklists Kitchen reset/ }))
      .toHaveTextContent(progress);
  });
});

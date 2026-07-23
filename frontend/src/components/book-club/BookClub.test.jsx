import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import BookClub from "./BookClub.jsx";
import { getBookClub } from "../../api/bookClub.js";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));

vi.mock("../../api/bookClub.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getBookClub: vi.fn(),
}));

const ROOMMATES = [
  { id: "andre", name: "Andre", role: "admin" },
  { id: "kayla", name: "Kayla", role: "member" },
  { id: "sheryl", name: "Sheryl", role: "member" },
];

function summary(book = true) {
  return {
    configuration: {
      bookOwnerOrderUserIds: ["kayla", "andre", "sheryl"],
      snackOwnerOrderUserIds: ["andre", "sheryl", "kayla"],
    },
    activeBook: book ? { id: "book-1", title: "Parable of the Sower" } : null,
    openMeeting: null,
  };
}

function renderBookClub() {
  return render(
    <MemoryRouter>
      <BookClub roommates={ROOMMATES} groupId="book-club" />
    </MemoryRouter>,
  );
}

describe("BookClub household summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBookClub.mockResolvedValue({ summary: summary() });
  });
  afterEach(() => cleanup());

  it("shows the current read, owners, and a dedicated-page link", async () => {
    renderBookClub();

    expect(await screen.findByRole("heading", { name: "Parable of the Sower" })).toBeInTheDocument();
    expect(screen.getByText("Kayla")).toBeInTheDocument();
    expect(screen.getByText("Andre")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Book Club/ })).toHaveAttribute(
      "href",
      "/book-club",
    );
  });

  it("shows the active meeting owners even when the stored defaults differ", async () => {
    getBookClub.mockResolvedValue({
      summary: {
        ...summary(),
        openMeeting: {
          bookOwnerId: "andre",
          snackOwnerId: "sheryl",
        },
      },
    });
    renderBookClub();

    expect(await screen.findByText("Andre")).toBeInTheDocument();
    expect(screen.getByText("Sheryl")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
  });

  it("reloads after the shared Book Club change event", async () => {
    getBookClub
      .mockResolvedValueOnce({ summary: summary() })
      .mockResolvedValueOnce({ summary: {
        ...summary(),
        configuration: {
          bookOwnerOrderUserIds: ["andre", "kayla", "sheryl"],
          snackOwnerOrderUserIds: ["andre", "sheryl", "kayla"],
        },
      } });
    renderBookClub();
    await screen.findByText("Kayla");

    window.dispatchEvent(new Event("roomie:book-club-changed"));
    await waitFor(() => expect(getBookClub).toHaveBeenCalledTimes(2));
  });
});

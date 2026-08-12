import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request, setInvalidUserHandler, withQuery } from "./request.js";

function jsonResponse(data, ok = true, status = 200) {
  return { ok, status, json: vi.fn().mockResolvedValue(data) };
}

describe("API request helper", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    setInvalidUserHandler(null);
    vi.unstubAllGlobals();
  });

  it("applies the active group scope while allowing an explicit scope to override it", async () => {
    localStorage.setItem("roomie-session", JSON.stringify({ activeGroupId: "shire" }));
    fetch.mockResolvedValue(jsonResponse({ ok: true }));

    await request("/roommates?userId=andre", {
      headers: { "X-Roomie-Group-ID": "book-club" },
    });

    expect(fetch).toHaveBeenCalledWith("/api/roommates?userId=andre", {
      headers: {
        "Content-Type": "application/json",
        "X-Roomie-Group-ID": "book-club",
      },
    });
  });

  it("notifies auth and throws the API error for an invalid user", async () => {
    const onInvalidUser = vi.fn();
    setInvalidUserHandler(onInvalidUser);
    fetch.mockResolvedValue(
      jsonResponse({ code: "invalid_user", error: "Session expired" }, false, 401),
    );

    await expect(request("/accounts/andre")).rejects.toThrow("Session expired");
    expect(onInvalidUser).toHaveBeenCalledOnce();
  });

  it("omits empty query parameters", () => {
    expect(withQuery("/feed", { userId: "andre", type: "", page: null })).toBe(
      "/feed?userId=andre",
    );
  });

  it("repeats array query parameters", () => {
    expect(withQuery("/feed", { userId: "andre", type: ["events", "polls"] })).toBe(
      "/feed?userId=andre&type=events&type=polls",
    );
  });
});

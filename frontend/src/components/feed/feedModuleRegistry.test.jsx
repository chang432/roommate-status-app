import { describe, expect, it } from "vitest";
import {
  FEED_MODULE_REGISTRY,
  FEED_MODULE_TYPES,
  canCreateFeedModule,
  isFeedModuleEnabled,
} from "./feedModuleRegistry.jsx";

describe("feed module registry", () => {
  it("is the complete source for navigable module metadata and UI handlers", () => {
    expect(FEED_MODULE_TYPES.slice(1).map(({ id }) => id)).toEqual(
      Object.keys(FEED_MODULE_REGISTRY),
    );

    Object.values(FEED_MODULE_REGISTRY).forEach((definition) => {
      expect(definition).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          label: expect.any(String),
          shortLabel: expect.any(String),
          createLabel: expect.any(String),
          edit: expect.objectContaining({ label: expect.any(String) }),
          renderCard: expect.any(Function),
          renderCreate: expect.any(Function),
        }),
      );
    });
  });

  it("keeps standard, shared, and Book Club availability declarative", () => {
    const standardOnly = {
      showStandardModules: true,
      showBookClub: false,
    };
    const bookClubOnly = {
      showStandardModules: false,
      showBookClub: true,
    };

    expect(isFeedModuleEnabled(FEED_MODULE_REGISTRY.events, standardOnly)).toBe(true);
    expect(isFeedModuleEnabled(FEED_MODULE_REGISTRY.events, bookClubOnly)).toBe(false);
    expect(isFeedModuleEnabled(FEED_MODULE_REGISTRY.polls, standardOnly)).toBe(true);
    expect(isFeedModuleEnabled(FEED_MODULE_REGISTRY.polls, bookClubOnly)).toBe(true);
    expect(isFeedModuleEnabled(FEED_MODULE_REGISTRY["book-club"], standardOnly)).toBe(false);
    expect(isFeedModuleEnabled(FEED_MODULE_REGISTRY["book-club"], bookClubOnly)).toBe(true);
    expect(isFeedModuleEnabled(FEED_MODULE_REGISTRY.forums, standardOnly)).toBe(false);
    expect(isFeedModuleEnabled(FEED_MODULE_REGISTRY.forums, bookClubOnly)).toBe(true);
  });

  it("keeps module-specific create permission in the module definition", () => {
    expect(
      canCreateFeedModule(FEED_MODULE_REGISTRY["book-club"], {
        canAdministerBookClub: false,
      }),
    ).toBe(false);
    expect(
      canCreateFeedModule(FEED_MODULE_REGISTRY.events, {
        canAdministerBookClub: false,
      }),
    ).toBe(true);
  });
});

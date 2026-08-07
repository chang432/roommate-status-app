import { describe, expect, it } from "vitest";
import {
  FEED_MODULE_REGISTRY,
  FEED_MODULE_TYPES,
  canCreateFeedModule,
} from "./feedModuleRegistry.jsx";
import { GROUP_MODULE_IDS } from "../../models/groupModules.js";

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

  it("covers every group module rendered in the feed", () => {
    expect(Object.keys(FEED_MODULE_REGISTRY)).toEqual(
      GROUP_MODULE_IDS.filter((id) => !["roster", "spotify"].includes(id)),
    );
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

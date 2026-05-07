import { describe, it, expect } from "vitest";
import { prefersChannel } from "../convex/utils/notificationChannels";

// Minimal stand-in for the Doc<"notificationPreferences"> shape — the
// helper only reads category fields by string key, so a partial row is
// sufficient for testing the read path.
function row(fields: Record<string, unknown>) {
  return fields as unknown as Parameters<typeof prefersChannel>[0];
}

describe("prefersChannel", () => {
  describe("missing prefs", () => {
    it("returns the default (true) when the row is null", () => {
      expect(prefersChannel(null, "eventInvited", "push")).toBe(true);
      expect(prefersChannel(null, "eventInvited", "email")).toBe(true);
    });

    it("returns the default when the row is undefined", () => {
      expect(prefersChannel(undefined, "eventInvited", "push")).toBe(true);
      expect(prefersChannel(undefined, "eventInvited", "email")).toBe(true);
    });

    it("returns the default when the field is missing on the row", () => {
      expect(prefersChannel(row({}), "eventInvited", "push")).toBe(true);
      expect(prefersChannel(row({}), "eventInvited", "email")).toBe(true);
    });
  });

  describe("legacy boolean shape", () => {
    it("true gates push on; email defaults to true (legacy users haven't opted out)", () => {
      const r = row({ eventInvited: true });
      expect(prefersChannel(r, "eventInvited", "push")).toBe(true);
      expect(prefersChannel(r, "eventInvited", "email")).toBe(true);
    });

    it("false gates push off; email still defaults to true", () => {
      const r = row({ eventInvited: false });
      expect(prefersChannel(r, "eventInvited", "push")).toBe(false);
      expect(prefersChannel(r, "eventInvited", "email")).toBe(true);
    });

    it("works the same way for non-event categories that only support push", () => {
      const r = row({ chatMention: false });
      expect(prefersChannel(r, "chatMention", "push")).toBe(false);
      // Email is meaningless for chat today; default true is harmless
      // because no email path consults this.
      expect(prefersChannel(r, "chatMention", "email")).toBe(true);
    });
  });

  describe("object shape", () => {
    it("returns the requested channel independently", () => {
      const r = row({ eventInvited: { push: true, email: false } });
      expect(prefersChannel(r, "eventInvited", "push")).toBe(true);
      expect(prefersChannel(r, "eventInvited", "email")).toBe(false);
    });

    it("supports email-on / push-off", () => {
      const r = row({ eventInvited: { push: false, email: true } });
      expect(prefersChannel(r, "eventInvited", "push")).toBe(false);
      expect(prefersChannel(r, "eventInvited", "email")).toBe(true);
    });

    it("supports both off", () => {
      const r = row({ eventUpdated: { push: false, email: false } });
      expect(prefersChannel(r, "eventUpdated", "push")).toBe(false);
      expect(prefersChannel(r, "eventUpdated", "email")).toBe(false);
    });

    it("evaluates each event category independently", () => {
      const r = row({
        eventInvited: { push: true, email: true },
        eventUpdated: { push: false, email: true },
        eventCancelled: { push: true, email: false },
      });
      expect(prefersChannel(r, "eventInvited", "push")).toBe(true);
      expect(prefersChannel(r, "eventInvited", "email")).toBe(true);
      expect(prefersChannel(r, "eventUpdated", "push")).toBe(false);
      expect(prefersChannel(r, "eventUpdated", "email")).toBe(true);
      expect(prefersChannel(r, "eventCancelled", "push")).toBe(true);
      expect(prefersChannel(r, "eventCancelled", "email")).toBe(false);
    });
  });
});

import { describe, expect, it } from "vitest";
import { mentionTitle } from "../convex/lib/mentionTitle";

describe("mentionTitle", () => {
  it("names the channel for an ordinary channel", () => {
    expect(mentionTitle("Ada", { kind: "channel", name: "general" })).toBe(
      "Ada mentioned you in #general",
    );
  });

  it("names a closed channel the same way", () => {
    expect(mentionTitle("Ada", { kind: "channel", name: "leadership" })).toBe(
      "Ada mentioned you in #leadership",
    );
  });

  it("omits the channel entirely for a DM", () => {
    // A DM stores no name, so `#${channel.name}` used to render a dangling
    // "#". There is also nothing useful to put there: in a two-person
    // conversation the sender is already named, and the only other
    // participant is the person being notified.
    expect(mentionTitle("Ada", { kind: "dm", name: "" })).toBe("Ada mentioned you");
  });
});

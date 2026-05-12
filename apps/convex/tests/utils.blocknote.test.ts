import { describe, it, expect } from "vitest";
import {
  extractEventMentionIds,
  extractMessageTargets,
  extractPlainTextFromBody,
} from "../convex/utils/blocknote";

const eventInline = (eventId: string) => ({
  type: "eventMention",
  props: { eventId },
});

const textBlock = (children: any[]) => ({
  type: "paragraph",
  content: children,
});

describe("blocknote utils — @event mention helpers", () => {
  describe("extractEventMentionIds", () => {
    it("collects unique eventIds from a flat body", () => {
      const body = JSON.stringify([
        textBlock([
          { type: "text", text: "see ", styles: {} },
          eventInline("evt-1"),
          { type: "text", text: " and ", styles: {} },
          eventInline("evt-2"),
        ]),
      ]);
      expect(extractEventMentionIds(body).sort()).toEqual(["evt-1", "evt-2"]);
    });

    it("dedupes repeated mentions", () => {
      const body = JSON.stringify([
        textBlock([eventInline("evt-1"), eventInline("evt-1"), eventInline("evt-1")]),
      ]);
      expect(extractEventMentionIds(body)).toEqual(["evt-1"]);
    });

    it("descends into nested children", () => {
      const body = JSON.stringify([
        {
          type: "bulletListItem",
          content: [{ type: "text", text: "parent", styles: {} }],
          children: [
            textBlock([eventInline("evt-deep")]),
          ],
        },
      ]);
      expect(extractEventMentionIds(body)).toEqual(["evt-deep"]);
    });

    it("walks inline content inside links", () => {
      const body = JSON.stringify([
        textBlock([
          {
            type: "link",
            href: "https://example.com",
            content: [eventInline("evt-link")],
          },
        ]),
      ]);
      expect(extractEventMentionIds(body)).toEqual(["evt-link"]);
    });

    it("returns [] for malformed JSON", () => {
      expect(extractEventMentionIds("not-json")).toEqual([]);
    });

    it("skips mentions without an eventId", () => {
      const body = JSON.stringify([
        textBlock([{ type: "eventMention", props: {} }]),
      ]);
      expect(extractEventMentionIds(body)).toEqual([]);
    });
  });

  describe("extractMessageTargets", () => {
    it("classifies event mentions as targetType=calendarEvent", () => {
      const body = JSON.stringify([textBlock([eventInline("evt-1")])]);
      const targets = extractMessageTargets(body);
      expect(targets).toEqual([{ targetType: "calendarEvent", targetId: "evt-1" }]);
    });

    it("dedupes across mention types sharing the same id (defensive)", () => {
      // Different target types, same id — both kept (different type)
      const body = JSON.stringify([
        textBlock([
          eventInline("xxx"),
          { type: "userMention", props: { userId: "yyy" } },
        ]),
      ]);
      const targets = extractMessageTargets(body);
      expect(targets.length).toBe(2);
    });
  });

  describe("extractPlainTextFromBody — event mentions", () => {
    it("renders @<title> when eventTitles is supplied", () => {
      const body = JSON.stringify([
        textBlock([
          { type: "text", text: "see ", styles: {} },
          eventInline("evt-1"),
          { type: "text", text: "!", styles: {} },
        ]),
      ]);
      const titles = new Map([["evt-1", "Team Standup"]]);
      expect(extractPlainTextFromBody(body, undefined, undefined, titles)).toBe(
        "see @Team Standup!",
      );
    });

    it("falls back to '@event' when title is missing", () => {
      const body = JSON.stringify([textBlock([eventInline("missing")])]);
      expect(extractPlainTextFromBody(body)).toBe("@event");
    });
  });
});

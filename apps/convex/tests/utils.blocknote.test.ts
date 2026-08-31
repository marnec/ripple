import { describe, it, expect } from "vitest";
import {
  extractEventMentionIds,
  extractEventSeriesMentionIds,
  extractMessageTargets,
  extractPlainTextFromBody,
} from "../convex/utils/blocknote";

const eventInline = (eventId: string) => ({
  type: "eventMention",
  props: { eventId },
});

/** The same chip, pointing at a series rather than at an event row. */
const seriesInline = (seriesId: string) => ({
  type: "eventMention",
  props: { seriesId },
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

    it("names a mentioned series, whose id sits under a different prop", () => {
      // The one place a mention's text escapes the app entirely — onto a lock
      // screen — so "@event" where the sender wrote "@Standup" is a real loss.
      const body = JSON.stringify([textBlock([seriesInline("ser-1")])]);
      const titles = new Map([["ser-1", "Standup"]]);
      expect(extractPlainTextFromBody(body, undefined, undefined, titles)).toBe(
        "@Standup",
      );
    });
  });

  describe("mentions of a series", () => {
    it("are collected apart from event mentions", () => {
      const body = JSON.stringify([
        textBlock([eventInline("evt-1"), seriesInline("ser-1")]),
      ]);
      expect(extractEventMentionIds(body)).toEqual(["evt-1"]);
      expect(extractEventSeriesMentionIds(body)).toEqual(["ser-1"]);
    });

    it("are classified as targetType=eventSeries", () => {
      const body = JSON.stringify([textBlock([seriesInline("ser-1")])]);
      expect(extractMessageTargets(body)).toEqual([
        { targetType: "eventSeries", targetId: "ser-1" },
      ]);
    });
  });
});

describe("extractPlainTextFromBody — the notification projection", () => {
  const tableBlock = (rows: string[][]) => ({
    type: "table",
    content: {
      type: "tableContent",
      rows: rows.map((cells) => ({
        cells: cells.map((text) => ({
          type: "tableCell",
          props: {},
          content: [{ type: "text", text, styles: {} }],
        })),
      })),
    },
  });

  const chip = (props: Record<string, string>) => ({
    type: "resourceReference",
    props,
  });

  it("states the range on a chip that heads a frozen table", () => {
    const body = JSON.stringify([
      textBlock([
        chip({
          resourceId: "s1",
          resourceType: "spreadsheet",
          resourceName: "Budget",
          cellRef: "B2:D5",
        }),
      ]),
    ]);
    expect(extractPlainTextFromBody(body)).toBe("#Budget \u203A B2:D5");
  });

  it("leaves a chip without a range exactly as it was", () => {
    const body = JSON.stringify([
      textBlock([
        chip({ resourceId: "s1", resourceType: "spreadsheet", resourceName: "Budget" }),
      ]),
    ]);
    expect(extractPlainTextFromBody(body)).toBe("#Budget");
  });

  it("contributes nothing for a table's cells, unlike the client's converter", () => {
    // A lock screen and a reply preview want the chip, not 97 characters of
    // pipe-separated numbers. The client's blocksToPlainText DOES flatten
    // these, because it composes the plainText that `search` indexes.
    const body = JSON.stringify([
      textBlock([
        chip({
          resourceId: "s1",
          resourceType: "spreadsheet",
          resourceName: "Budget",
          cellRef: "A1:B2",
        }),
      ]),
      tableBlock([["1200", "1450"]]),
    ]);
    expect(extractPlainTextFromBody(body)).toBe("#Budget \u203A A1:B2");
  });
});

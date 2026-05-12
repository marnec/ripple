import { describe, it, expect } from "vitest";
import { extractEventMentions, extractMentions } from "./use-editor-tracking";

const para = (content: unknown[]) => ({ type: "paragraph", content });
const eventMention = (eventId: string) => ({
  type: "eventMention",
  props: { eventId },
});
const userMention = (userId: string) => ({
  type: "mention",
  props: { userId },
});

describe("extractEventMentions", () => {
  it("collects unique eventIds across a flat document", () => {
    const blocks = [
      para([
        { type: "text", text: "Hi ", styles: {} },
        eventMention("evt-a"),
        { type: "text", text: " and ", styles: {} },
        eventMention("evt-b"),
      ]),
    ];
    const ids = [...extractEventMentions(blocks)].sort();
    expect(ids).toEqual(["evt-a", "evt-b"]);
  });

  it("dedupes repeated mentions", () => {
    const blocks = [
      para([eventMention("evt-1"), eventMention("evt-1")]),
      para([eventMention("evt-1")]),
    ];
    expect([...extractEventMentions(blocks)]).toEqual(["evt-1"]);
  });

  it("descends into nested children", () => {
    const blocks = [
      {
        type: "bulletListItem",
        content: [{ type: "text", text: "outer", styles: {} }],
        children: [para([eventMention("evt-nested")])],
      },
    ];
    expect([...extractEventMentions(blocks)]).toEqual(["evt-nested"]);
  });

  it("walks inline cells in table content", () => {
    const blocks = [
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            {
              cells: [
                { content: [eventMention("evt-cell")] },
              ],
            },
          ],
        },
      },
    ];
    expect([...extractEventMentions(blocks)]).toEqual(["evt-cell"]);
  });

  it("ignores blocks with no event mentions", () => {
    const blocks = [
      para([{ type: "text", text: "plain", styles: {} }]),
      para([userMention("user-1")]),
    ];
    expect(extractEventMentions(blocks).size).toBe(0);
  });

  it("is independent of extractMentions (user mentions)", () => {
    const blocks = [
      para([userMention("user-1"), eventMention("evt-1")]),
    ];
    expect([...extractMentions(blocks)]).toEqual(["user-1"]);
    expect([...extractEventMentions(blocks)]).toEqual(["evt-1"]);
  });

  it("skips eventMention nodes with no eventId", () => {
    const blocks = [
      para([{ type: "eventMention", props: {} }]),
    ];
    expect(extractEventMentions(blocks).size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { clip, TRUNCATED_MARKER } from "../convex/lib/assistantTools";
import { renderReferencedContext, type ReferencedContext } from "../convex/lib/chatAssistant";
import { extractReferenceChips } from "../convex/utils/blocknote";

/**
 * The pure half of the chat assistant's **referenced context**: how the
 * chips of a summoning message read once loaded, before the model runs.
 */

describe("renderReferencedContext", () => {
  it("renders nothing when the message carried no chips", () => {
    expect(renderReferencedContext([])).toBe("");
  });

  it("lays out each read chip under its name, type and id", () => {
    const entries: ReferencedContext[] = [
      { type: "document", id: "d1", name: "Roadmap", status: "read", content: "Ship in Q4." },
      { type: "task", id: "t1", name: "Key rotation", status: "read", content: "Rotate it." },
    ];
    const out = renderReferencedContext(entries);
    expect(out).toContain("Roadmap (document d1)");
    expect(out).toContain("Ship in Q4.");
    expect(out).toContain("Key rotation (task t1)");
    expect(out.indexOf("Roadmap")).toBeLessThan(out.indexOf("Key rotation"));
  });

  it("says when a chip is referenced but not readable, empty, or not accessible", () => {
    const out = renderReferencedContext([
      { type: "diagram", id: "g1", name: "Flow", status: "not-readable" },
      { type: "document", id: "d2", name: "Blank", status: "empty" },
      { type: "document", id: "d3", name: "Gone", status: "not-accessible" },
    ]);
    expect(out).toMatch(/Flow \(diagram g1\).*not readable/s);
    expect(out).toMatch(/Blank \(document d2\).*empty/s);
    expect(out).toMatch(/Gone \(document d3\).*not found, or you do not have access/is);
  });
});

describe("extractReferenceChips", () => {
  const body = (content: unknown[]) =>
    JSON.stringify([{ id: "b1", type: "paragraph", props: {}, content, children: [] }]);

  it("lists every chip once, in order, and skips people", () => {
    const chips = extractReferenceChips(
      body([
        { type: "userMention", props: { userId: "u1" } },
        { type: "resourceReference", props: { resourceId: "d1", resourceType: "document", resourceName: "Roadmap" } },
        { type: "taskMention", props: { taskId: "t1", taskTitle: "Key rotation" } },
        { type: "projectReference", props: { projectId: "p1" } },
        { type: "eventMention", props: { seriesId: "s1" } },
        { type: "resourceReference", props: { resourceId: "d1", resourceType: "document", resourceName: "Roadmap" } },
      ]),
    );
    expect(chips).toEqual([
      { type: "document", id: "d1", name: "Roadmap" },
      { type: "task", id: "t1", name: "Key rotation" },
      { type: "project", id: "p1" },
      { type: "series", id: "s1" },
    ]);
  });

  it("returns nothing for a body that is not BlockNote JSON", () => {
    expect(extractReferenceChips("not json")).toEqual([]);
  });
});

describe("clip", () => {
  it("returns text within the limit untouched", () => {
    expect(clip("short", 10)).toBe("short");
    expect(clip("exactly ten", 11)).toBe("exactly ten");
  });

  it("cuts text over the limit and marks the cut", () => {
    expect(clip("0123456789abc", 10)).toBe("0123456789" + TRUNCATED_MARKER);
  });
});

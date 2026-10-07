import { describe, expect, it } from "vitest";
import type { Reference } from "@/components/embed-references";
import { groupTaskReferences } from "./taskReferences";

let nextId = 0;
function ref(sourceType: string, sourceName: string, edgeType = "mentions", sourceId?: string): Reference {
  nextId += 1;
  return {
    _id: `edge-${nextId}`,
    sourceType,
    sourceId: sourceId ?? `${sourceType}-${sourceName}`,
    sourceName,
    edgeType,
    workspaceId: "ws",
  };
}

describe("groupTaskReferences", () => {
  it("groups by source type, documents and channels first", () => {
    const groups = groupTaskReferences([
      ref("task", "Other task", "embeds"),
      ref("channel", "#eng"),
      ref("document", "Spec", "embeds"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Documents", "Channels", "Tasks"]);
  });

  it("leaves dependency edges to the Dependencies section", () => {
    const groups = groupTaskReferences([
      ref("task", "Blocker", "blocks"),
      ref("task", "Sibling", "relates_to"),
    ]);
    expect(groups).toEqual([]);
  });

  it("lists a source once even when it both embeds and mentions the task", () => {
    const groups = groupTaskReferences([
      ref("document", "Spec", "embeds", "doc-1"),
      ref("document", "Spec", "mentions", "doc-1"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].references).toHaveLength(1);
  });

  it("sorts a group's references by name", () => {
    const groups = groupTaskReferences([
      ref("document", "Zeta"),
      ref("document", "Alpha"),
    ]);
    expect(groups[0].references.map((r) => r.sourceName)).toEqual(["Alpha", "Zeta"]);
  });
});

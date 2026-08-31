import { describe, expect, it } from "vitest";

import { eventLinkView } from "./event-link";

describe("what an /events/:id link asks for", () => {
  it("is one occurrence when the URL carries an original start", () => {
    // The coordinate is what makes "moved to Thursday" land on the right date
    // rather than on the series.
    expect(eventLinkView("1757314800000")).toEqual({
      kind: "occurrence",
      originalStartMs: 1757314800000,
    });
  });

  it("is one occurrence even at the epoch, which is a real instant", () => {
    expect(eventLinkView("0")).toEqual({ kind: "occurrence", originalStartMs: 0 });
  });

  it("is the bare link when there is no coordinate at all", () => {
    expect(eventLinkView(null)).toEqual({ kind: "bare" });
  });

  it("is not a coordinate when the parameter is present but empty", () => {
    // `Number("")` is 0, which would silently open an occurrence in 1970.
    expect(eventLinkView("")).toEqual({ kind: "invalid" });
  });

  it("is not a coordinate when the parameter is not a number", () => {
    expect(eventLinkView("tuesday")).toEqual({ kind: "invalid" });
  });
});

import { describe, expect, it } from "vitest";
import {
  appendRippleCommentMarker,
  appendRippleTaskMarker,
  extractRippleCommentId,
  extractRippleTaskId,
  stripRippleMarker,
  stripRippleMarkers,
} from "../convex/integrations/core/rippleMarker";
import type { Id } from "../convex/_generated/dataModel";

const TASK_ID = "kh79nqjg5w69m8xx7e5gwj5hph87kc8p" as Id<"tasks">;
const OTHER_TASK_ID = "kh79othersample123456789abcdefghi" as Id<"tasks">;
const COMMENT_ID = "js71commentsample01234567890abcd" as Id<"taskComments">;
const OTHER_COMMENT_ID = "js71othercomment01234567890abcde" as Id<"taskComments">;

describe("rippleMarker", () => {
  describe("appendRippleTaskMarker", () => {
    it("appends the marker to a non-empty body, separated by a blank line", () => {
      const body = "Hello world\n\nThis is the description.";
      const out = appendRippleTaskMarker(body, TASK_ID);
      expect(out).toBe(
        `Hello world\n\nThis is the description.\n\n<!-- ripple-task: ${TASK_ID} -->`,
      );
    });

    it("returns just the marker for an empty body (no leading blank line)", () => {
      expect(appendRippleTaskMarker("", TASK_ID)).toBe(
        `<!-- ripple-task: ${TASK_ID} -->`,
      );
    });

    it("trims trailing whitespace before appending so diffs stay clean on re-edit", () => {
      const body = "Body text.\n\n\n\n   ";
      const out = appendRippleTaskMarker(body, TASK_ID);
      expect(out).toBe(`Body text.\n\n<!-- ripple-task: ${TASK_ID} -->`);
    });

    it("is idempotent when the body already carries the same marker", () => {
      const body = `Hello\n\n<!-- ripple-task: ${TASK_ID} -->`;
      expect(appendRippleTaskMarker(body, TASK_ID)).toBe(body);
    });

    it("throws when the body already carries a marker for a DIFFERENT task", () => {
      const body = `Hello\n\n<!-- ripple-task: ${OTHER_TASK_ID} -->`;
      expect(() => appendRippleTaskMarker(body, TASK_ID)).toThrow(
        /refusing to overwrite/i,
      );
    });
  });

  describe("extractRippleTaskId", () => {
    it("returns the id when the marker is present", () => {
      const body = `Body\n\n<!-- ripple-task: ${TASK_ID} -->`;
      expect(extractRippleTaskId(body)).toBe(TASK_ID);
    });

    it("returns null for a body with no marker", () => {
      expect(extractRippleTaskId("just a normal issue body")).toBeNull();
    });

    it("returns null for undefined / null / empty body", () => {
      expect(extractRippleTaskId(undefined)).toBeNull();
      expect(extractRippleTaskId(null)).toBeNull();
      expect(extractRippleTaskId("")).toBeNull();
    });

    it("tolerates extra whitespace inside the comment (markdown formatters)", () => {
      const body = `Body\n\n<!--   ripple-task:   ${TASK_ID}   -->`;
      expect(extractRippleTaskId(body)).toBe(TASK_ID);
    });

    it("ignores unrelated HTML comments", () => {
      const body = "Body\n\n<!-- TODO: refactor this -->";
      expect(extractRippleTaskId(body)).toBeNull();
    });

    it("survives a body where the marker is mid-document (not last line)", () => {
      // A user might paste content below the marker. The marker still works.
      const body = `Header\n\n<!-- ripple-task: ${TASK_ID} -->\n\nMore content after.`;
      expect(extractRippleTaskId(body)).toBe(TASK_ID);
    });
  });

  describe("stripRippleMarker", () => {
    it("removes the marker AND the blank line preceding it (clean round trip)", () => {
      const body = `Hello\n\n<!-- ripple-task: ${TASK_ID} -->`;
      expect(stripRippleMarker(body)).toBe("Hello");
    });

    it("returns an empty string for a body that was just the marker", () => {
      expect(stripRippleMarker(`<!-- ripple-task: ${TASK_ID} -->`)).toBe("");
    });

    it("is a no-op for a body with no marker", () => {
      const body = "Body text\n\nMore text.";
      expect(stripRippleMarker(body)).toBe(body);
    });

    it("only strips the marker at the very end, not one mid-document", () => {
      const body = `Header\n\n<!-- ripple-task: ${TASK_ID} -->\n\nMore content`;
      // Mid-document markers are deliberately preserved so we don't corrupt
      // user content that happens to contain a marker shape. The append helper
      // only ever writes the marker at the end, so this case shouldn't occur
      // in normal use.
      expect(stripRippleMarker(body)).toBe(body);
    });
  });

  /**
   * The comment marker exists for one job the task marker cannot do: making a
   * retried comment-create converge. A comment POST that commits but loses its
   * response is retried by the action-retrier, and without a way to ask the
   * host "did my last attempt land?" the retry posts a second comment on the
   * customer's issue tracker — one Ripple cannot even delete, since only the
   * last attempt's id ends up in `taskCommentIntegrationLinks`.
   *
   * Separate from `ripple-task:` rather than reusing it: a comment lives under
   * an issue that already carries a task marker, so one namespace would make
   * `findIssueByRippleTask`'s scan match comment bodies too.
   */
  describe("appendRippleCommentMarker / extractRippleCommentId", () => {
    it("appends the marker to a non-empty body, separated by a blank line", () => {
      const out = appendRippleCommentMarker("Looks good to me.", COMMENT_ID);
      expect(out).toBe(
        `Looks good to me.\n\n<!-- ripple-comment: ${COMMENT_ID} -->`,
      );
    });

    it("is idempotent, and refuses to overwrite another comment's marker", () => {
      const tagged = appendRippleCommentMarker("hi", COMMENT_ID);
      expect(appendRippleCommentMarker(tagged, COMMENT_ID)).toBe(tagged);
      expect(() => appendRippleCommentMarker(tagged, OTHER_COMMENT_ID)).toThrow(
        /refusing to overwrite/i,
      );
    });

    it("round-trips, and does not answer to the task namespace", () => {
      const tagged = appendRippleCommentMarker("body", COMMENT_ID);
      expect(extractRippleCommentId(tagged)).toBe(COMMENT_ID);
      // The issue this comment hangs off carries a task marker; a shared
      // namespace would let `findIssueByRippleTask`'s body scan match here.
      expect(extractRippleTaskId(tagged)).toBeNull();
      expect(
        extractRippleCommentId(appendRippleTaskMarker("body", TASK_ID)),
      ).toBeNull();
    });
  });

  /**
   * The inbound half of the deal. The marker is provider-side metadata; a
   * human editing Ripple's mirrored comment on GitHub sends the whole raw body
   * back, marker included, and `comment.edited` would otherwise store it and
   * seed it into the BlockNote comment the user reads.
   */
  describe("stripRippleMarkers", () => {
    it("strips either marker from the end of a body", () => {
      expect(
        stripRippleMarkers(appendRippleCommentMarker("Hello", COMMENT_ID)),
      ).toBe("Hello");
      expect(stripRippleMarkers(appendRippleTaskMarker("Hello", TASK_ID))).toBe(
        "Hello",
      );
    });

    it("is a no-op for a body with no marker", () => {
      expect(stripRippleMarkers("Body text\n\nMore text.")).toBe(
        "Body text\n\nMore text.",
      );
    });
  });

  describe("round trip", () => {
    it("append → extract returns the original id", () => {
      const body = appendRippleTaskMarker("Issue body here.", TASK_ID);
      expect(extractRippleTaskId(body)).toBe(TASK_ID);
    });

    it("append → strip returns the original body", () => {
      const original = "Issue body here.";
      const tagged = appendRippleTaskMarker(original, TASK_ID);
      expect(stripRippleMarker(tagged)).toBe(original);
    });
  });
});

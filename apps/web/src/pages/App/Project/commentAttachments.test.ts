import { describe, expect, it } from "vitest";
import { joinCommentBody, splitCommentBody } from "./commentAttachments";

const paragraph = { id: "p1", type: "paragraph", content: [{ type: "text", text: "see log", styles: {} }] };
const log = { url: "https://x/api/storage/abc", name: "crash.log", mimeType: "text/plain", size: 120 };

describe("comment attachments", () => {
  it("round-trips the editor's blocks and the attachments", () => {
    const body = joinCommentBody([paragraph], [log]);
    expect(splitCommentBody(body)).toEqual({ blocks: [paragraph], attachments: [log] });
  });

  it("keeps a body without attachments exactly as the editor wrote it", () => {
    expect(JSON.parse(joinCommentBody([paragraph], []))).toEqual([paragraph]);
    expect(splitCommentBody(JSON.stringify([paragraph]))).toEqual({
      blocks: [paragraph],
      attachments: [],
    });
  });

  it("drops a file block with no URL and names an unnamed one", () => {
    const body = JSON.stringify([
      { type: "file", props: {} },
      { type: "file", props: { url: "https://x/api/storage/def" } },
    ]);
    expect(splitCommentBody(body).attachments).toEqual([
      { url: "https://x/api/storage/def", name: "attachment", mimeType: undefined, size: undefined },
    ]);
  });

  it("treats a legacy plain-text body as one paragraph with no attachments", () => {
    const { blocks, attachments } = splitCommentBody("just text");
    expect(attachments).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });
});

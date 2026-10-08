import { describe, expect, it } from "vitest";
import { messageBodyToCommentBody } from "../convex/lib/messageCapture";

const text = (t: string) => ({ type: "text", text: t, styles: {} });
const convert = (blocks: unknown[], projects: [string, string][] = []) =>
  JSON.parse(messageBodyToCommentBody(JSON.stringify(blocks), "plain", new Map(projects)));

/**
 * A chat body re-expressed in the task-comment schema, which has no reference
 * inline content and holds uploads as trailing `file` blocks.
 */
describe("messageBodyToCommentBody", () => {
  it("flattens task, project and resource chips to #name text", () => {
    const [block] = convert(
      [
        {
          type: "paragraph",
          content: [
            { type: "taskMention", props: { taskId: "t1", taskTitle: "Fix login" } },
            text(" in "),
            { type: "projectReference", props: { projectId: "p1" } },
            text(" see "),
            { type: "resourceReference", props: { resourceId: "d1", resourceType: "document", resourceName: "Spec" } },
          ],
        },
      ],
      [["p1", "Eng"]],
    );
    expect(block.content).toEqual([text("#Fix login"), text(" in "), text("#Eng"), text(" see "), text("#Spec")]);
  });

  it("keeps user and event mentions, which comments support", () => {
    const mention = { type: "userMention", props: { userId: "u1" } };
    const [block] = convert([{ type: "paragraph", content: [mention] }]);
    expect(block.content).toEqual([mention]);
  });

  it("flattens chips inside links and nested blocks", () => {
    const [block] = convert([
      {
        type: "bulletListItem",
        content: [{ type: "link", href: "x", content: [{ type: "taskMention", props: { taskTitle: "A" } }] }],
        children: [{ type: "paragraph", content: [{ type: "projectReference", props: { projectId: "gone" } }] }],
      },
    ]);
    expect(block.content[0].content).toEqual([text("#A")]);
    expect(block.children[0].content).toEqual([text("#project")]);
  });

  it("turns an image into a trailing file attachment of the full-size upload", () => {
    const blocks = convert([
      { type: "image", props: { url: "thumb", fullUrl: "full", diagramName: "Flow" } },
      { type: "paragraph", content: [text("caption")] },
    ]);
    expect(blocks).toEqual([
      { type: "paragraph", content: [text("caption")] },
      { type: "file", props: { url: "full", name: "Flow" } },
    ]);
  });

  it("falls back to the plain text for a body that is not BlockNote JSON", () => {
    expect(JSON.parse(messageBodyToCommentBody("not json", "hello", new Map()))).toEqual([
      { type: "paragraph", content: [text("hello")] },
    ]);
  });
});

import type { Id } from "@convex/_generated/dataModel";

/** Minimal user shape used across comment editors and activity timelines. */
export type WorkspaceMemberSummary = {
  _id: Id<"users">;
  name?: string;
  image?: string;
};

export type EditCommentEditorProps = {
  commentId: Id<"taskComments">;
  initialBody: string;
  workspaceMembers: WorkspaceMemberSummary[];
  /** Used for `@event` autocomplete in the edit composer. */
  workspaceId: Id<"workspaces">;
  uploadFile?: (file: File) => Promise<string>;
  onSave: (id: Id<"taskComments">, body: string, bodyMarkdown: string) => void;
  onCancel: () => void;
};

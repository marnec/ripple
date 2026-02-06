import { Id } from "../../convex/_generated/dataModel"

export type QueryParams = {
  workspaceId: Id<"workspaces">
  channelId: Id<"channels">
  documentId: Id<"documents">
  diagramId: Id<"diagrams">
  projectId: Id<"projects">
  taskId: Id<"tasks">
}
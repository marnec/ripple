import { Doc } from "../../convex/_generated/dataModel";

export type DiagramMember = Doc<"diagramMembers"> & { user: Doc<"users"> };

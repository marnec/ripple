import { Schema } from "../enums/schema";
import { Id } from "../../convex/_generated/dataModel";
import { WorkspaceRole } from "../enums/roles";

export interface Workspace {
  _id: Id<typeof Schema.workspaces>;
  name: string;
  description?: string;
  ownerId: Id<typeof Schema.users>;
}

export interface WorkspaceMember {
  _id: Id<typeof Schema.workspaceMembers>;
  userId: Id<typeof Schema.users>;
  workspaceId: Id<typeof Schema.workspaces>;
  role: WorkspaceRole;
}       

import { Id } from "../../convex/_generated/dataModel";
import { WorkspaceRole } from "../enums/roles";

export interface Workspace {
  _id: Id<"workspaces">;
  name: string;
  description?: string;
  ownerId: Id<"users">;
}

export interface WorkspaceMember {
  _id: Id<"workspaceMembers">;
  userId: Id<"users">;
  workspaceId: Id<"workspaces">;
  role: WorkspaceRole;
}       

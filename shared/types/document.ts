import { Doc } from "../../convex/_generated/dataModel";

export type DocumentMember = Doc<"documentMembers"> & { user: Doc<"users"> }; 
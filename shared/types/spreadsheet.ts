import { Doc } from "../../convex/_generated/dataModel";

export type SpreadsheetMember = Doc<"spreadsheetMembers"> & { user: Doc<"users"> };

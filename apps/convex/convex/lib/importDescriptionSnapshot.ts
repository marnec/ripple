import { v, type Infer } from "convex/values";

/**
 * One import row's pre-converted description blob, passed from the Node
 * conversion step (`taskImportDescriptions.ts`) to `createImportedTasks`.
 * Its own module so the Node bundle doesn't pull in `taskImports.ts`.
 */
export const descriptionSnapshotValidator = v.object({
  rowIndex: v.number(),
  storageId: v.id("_storage"),
});

export type DescriptionSnapshot = Infer<typeof descriptionSnapshotValidator>;

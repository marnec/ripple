import type { FavoritableResourceType } from "@ripple/shared/types/resources";

/**
 * The resources that have a collaborative surface of their own. A task's Yjs
 * room is collaborative too, but its description is a panel inside the task,
 * not a surface — it has no header and no settings route.
 */
export type SurfaceResourceType = "doc" | "diagram" | "spreadsheet";

/**
 * How each surface is named outside the collaboration layer.
 *
 * Lives beside the type rather than in either component, so the sequence and
 * the header read the same translation without one importing the other for it.
 */
export const NAMED: Record<SurfaceResourceType, FavoritableResourceType> = {
  doc: "document",
  diagram: "diagram",
  spreadsheet: "spreadsheet",
};

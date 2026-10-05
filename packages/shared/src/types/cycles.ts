export type CycleStatus = "open" | "closed";

/** Pre-migration statuses, still accepted by the schema until migrateCyclesToBacklogModel has run. */
export type LegacyCycleStatus = "draft" | "upcoming" | "active" | "completed";

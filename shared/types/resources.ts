/** Resource types that can be favorited (excludes channels). */
export type FavoritableResourceType = "document" | "diagram" | "spreadsheet" | "project";

/** All browsable resource types including channels. */
export type BrowsableResourceType = FavoritableResourceType | "channel";

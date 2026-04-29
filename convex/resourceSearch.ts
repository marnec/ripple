import type { PaginationOptions, PaginationResult } from "convex/server";
import { getAll } from "convex-helpers/server/relationships";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

// Maps the entityTags polymorphic literal to the actual table name. Tasks
// use `labels` not `tags` for filtering and live on a different list page,
// so they're intentionally excluded here.
export type ListableResourceType = "document" | "diagram" | "spreadsheet" | "project";

type TableFor<T extends ListableResourceType> =
  T extends "document" ? "documents"
  : T extends "diagram" ? "diagrams"
  : T extends "spreadsheet" ? "spreadsheets"
  : T extends "project" ? "projects"
  : never;

function emptyPage<U>(): PaginationResult<U> {
  return { page: [], isDone: true, continueCursor: "", splitCursor: null, pageStatus: null };
}

/**
 * Indexed inverse lookup: paginate resources of `resourceType` in `workspaceId`
 * that are tagged with all of `tags` (AND semantics).
 *
 * Uses `entityTags.by_workspace_tag_type` for the primary scan and the
 * resource's denormalized `tags` array for multi-tag intersection. Pages are
 * dense within the driver tag's set; the AND filter may thin a page when
 * multiple tags are selected (acceptable trade-off — alternative is unbounded
 * fan-out across all tags).
 *
 * In-page sort restores `_creationTime desc` to match the default workspace
 * branch's ordering. Across pages, blocks remain in tag-assignment order.
 */
export async function searchResourcesByTag<T extends ListableResourceType>(
  ctx: QueryCtx,
  args: {
    workspaceId: Id<"workspaces">;
    resourceType: T;
    tags: readonly string[];
    paginationOpts: PaginationOptions;
  },
): Promise<PaginationResult<Doc<TableFor<T>>>> {
  const required = args.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (required.length === 0) return emptyPage();

  const tagRows = await Promise.all(
    required.map((name) =>
      ctx.db
        .query("tags")
        .withIndex("by_workspace_name", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("name", name),
        )
        .unique(),
    ),
  );
  // Any unresolved name → no resource can match (stale UI / deleted-tag race).
  if (tagRows.some((r) => r === null)) return emptyPage();
  const tagIds = tagRows.map((r) => r!._id);

  const driverTagId = tagIds[0];
  const joinPage = await ctx.db
    .query("entityTags")
    .withIndex("by_workspace_tag_type", (q) =>
      q
        .eq("workspaceId", args.workspaceId)
        .eq("tagId", driverTagId)
        .eq("resourceType", args.resourceType),
    )
    .paginate(args.paginationOpts);

  const ids = joinPage.page.map((r) => r.resourceId as Id<TableFor<T>>);
  const fetched = await getAll(ctx.db, ids);
  let page = fetched.filter(
    (d): d is NonNullable<typeof d> => d !== null,
  ) as Doc<TableFor<T>>[];

  if (tagIds.length > 1) {
    page = page.filter((d) => {
      const labels = (d as { tags?: string[] }).tags;
      return labels !== undefined && required.every((n) => labels.includes(n));
    });
  }

  page.sort((a, b) => b._creationTime - a._creationTime);

  return { ...joinPage, page };
}

/**
 * Indexed lookup for the user's favorited resources of a given type. Drives
 * pagination off `favorites.by_workspace_user_type` so pages are dense.
 *
 * Anti-favorite (`isFavorite === false`) is intentionally NOT handled here —
 * scanning the resource table and excluding the favorite set is the cheaper
 * approach for that case. Callers should fall through to the default branch.
 */
export async function searchResourcesByFavorite<T extends ListableResourceType>(
  ctx: QueryCtx,
  args: {
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    resourceType: T;
    paginationOpts: PaginationOptions;
  },
): Promise<PaginationResult<Doc<TableFor<T>>>> {
  const favPage = await ctx.db
    .query("favorites")
    .withIndex("by_workspace_user_type", (q) =>
      q
        .eq("workspaceId", args.workspaceId)
        .eq("userId", args.userId)
        .eq("resourceType", args.resourceType),
    )
    .paginate(args.paginationOpts);

  const ids = favPage.page.map((f) => f.resourceId as Id<TableFor<T>>);
  const fetched = await getAll(ctx.db, ids);
  const page = (fetched.filter(
    (d): d is NonNullable<typeof d> => d !== null,
  ) as Doc<TableFor<T>>[]).sort((a, b) => b._creationTime - a._creationTime);

  return { ...favPage, page };
}

// Compile-time guard: TableFor outputs must be valid table names. Catches
// schema renames at typecheck time.
type _TableNameCheck = TableFor<ListableResourceType> extends TableNames ? true : never;
const _tableNameCheck: _TableNameCheck = true;
void _tableNameCheck;

import type { Id, TableNames } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Keep the ids that actually address a row in `table`, drop the rest.
 *
 * Ids parsed out of a document body are client-authored strings, not
 * `Id<T>` — a hand-edited BlockNote mention can name a table that doesn't
 * exist or nothing at all. `db.get`/`getAll` throw on a malformed id, so
 * anything that reads a body has to filter before it fetches; casting the
 * string to `Id<T>` only hides that from the compiler.
 */
export function normalizeIds<T extends TableNames>(
  db: QueryCtx["db"],
  table: T,
  ids: string[],
): Id<T>[] {
  const normalized: Id<T>[] = [];
  for (const id of ids) {
    const valid = db.normalizeId(table, id);
    if (valid !== null) normalized.push(valid);
  }
  return normalized;
}

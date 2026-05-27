import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

/**
 * The canonical shape of a task as rendered on the kanban board / cards.
 * Derived from the `tasks.listByProject` return validator (the query that
 * feeds the board) so the card components can never drift from the data they
 * actually receive — previously this object was hand-redeclared, and had
 * already diverged, in KanbanCard / KanbanColumn / KanbanCardPresenter.
 */
export type KanbanTask = FunctionReturnType<
  typeof api.tasks.listByProject
>[number];

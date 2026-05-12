/**
 * Remembers the last workspace the user was browsing so the root `/`
 * route can drop them back where they were instead of always showing
 * the workspaces list. WorkspaceLanding still owns the admin/member
 * fork after we land — this only short-circuits the *initial* choice
 * of which workspace to enter.
 *
 * Stored as a raw string (no JSON.stringify) since the Convex id is
 * already a plain string; this keeps reads cheap during the
 * synchronous render path that decides the root redirect.
 */
import type { Id } from "@convex/_generated/dataModel";

const STORAGE_KEY = "lastWorkspaceId";

export function getLastWorkspaceId(): Id<"workspaces"> | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (raw as Id<"workspaces">) : null;
}

export function setLastWorkspaceId(workspaceId: Id<"workspaces">): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, workspaceId);
}

export function clearLastWorkspaceId(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

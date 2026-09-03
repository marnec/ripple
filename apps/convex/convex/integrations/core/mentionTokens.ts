import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { getUserDisplayName } from "@ripple/shared/displayName";
import { memberToExternalLogin } from "./identity";

/**
 * Mention tokens in outbound markdown.
 *
 * The markdown that reaches a provider is rendered in the browser by
 * `blocksToMarkdownLossy`, where a mention knows the Ripple id it points at
 * and nothing else. Each mention spec therefore exports a stable token —
 * `@user:<id>`, `@event:<id>`, `@series:<id>` — and this module, called by
 * `outboundDispatch` right before a body is enqueued, rewrites the tokens with
 * what the *provider* should see. The stored BlockNote JSON is never touched.
 *
 * Rendering follows Linear's GitHub integration: a member who connected the
 * provider account becomes a real `@login` (a notification on their side);
 * anyone else becomes their plain display name, deliberately without `@`, so
 * the provider does not try to resolve a login that is not theirs. Events and
 * series become their title.
 *
 * The grammar has no markdown-special characters, so the token passes through
 * BlockNote's HTML → markdown step unescaped. A Convex id is lowercase base32;
 * the id class is a little wider than that so the same grammar also matches
 * the ids convex-test mints (which embed a camel-cased table name).
 */
export const MENTION_TOKEN_RE = /@(user|event|series):([A-Za-z0-9]+)/g;

export const UNKNOWN_USER = "@unknown-user";
export const UNKNOWN_EVENT = "unknown event";

/**
 * The provider-native way to mention `userId`, or undefined when the member
 * has not connected that provider. GitHub mentions by login, the same ref the
 * assignee push uses. GitLab assigns by numeric id but *mentions* by username,
 * so the login column is read directly rather than through the assignee ref.
 */
async function mentionLogin(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">,
  provider: string,
): Promise<string | undefined> {
  if (provider === "gitlab") {
    const user = await ctx.db.get(userId);
    return user?.gitlabLogin ?? undefined;
  }
  return memberToExternalLogin(ctx, workspaceId, userId, provider);
}

async function renderUser(
  ctx: QueryCtx,
  id: string,
  opts: { workspaceId: Id<"workspaces">; provider: string },
): Promise<string> {
  const userId = ctx.db.normalizeId("users", id);
  if (!userId) return UNKNOWN_USER;
  const user = await ctx.db.get(userId);
  if (!user) return UNKNOWN_USER;

  const membership = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", opts.workspaceId).eq("userId", userId),
    )
    .unique();
  if (membership) {
    const login = await mentionLogin(ctx, opts.workspaceId, userId, opts.provider);
    if (login) return `@${login}`;
  }
  return getUserDisplayName(user);
}

async function renderEvent(ctx: QueryCtx, id: string): Promise<string> {
  const eventId = ctx.db.normalizeId("calendarEvents", id);
  const event = eventId ? await ctx.db.get(eventId) : null;
  return event?.title ?? UNKNOWN_EVENT;
}

async function renderSeries(ctx: QueryCtx, id: string): Promise<string> {
  const seriesId = ctx.db.normalizeId("eventSeries", id);
  const series = seriesId ? await ctx.db.get(seriesId) : null;
  return series?.title ?? UNKNOWN_EVENT;
}

/**
 * Rewrite every mention token in `markdown` for `provider`. Idempotent on
 * token-free input; a body that never had a mention costs one regex scan.
 */
export async function renderMentionTokens(
  ctx: QueryCtx,
  markdown: string,
  opts: { workspaceId: Id<"workspaces">; provider: string },
): Promise<string> {
  const matches = [...markdown.matchAll(MENTION_TOKEN_RE)];
  if (matches.length === 0) return markdown;

  // Resolve each distinct token once; a body that mentions the same person
  // three times should not read them three times.
  const rendered = new Map<string, string>();
  for (const match of matches) {
    const token = match[0];
    if (rendered.has(token)) continue;
    const kind = match[1];
    const id = match[2];
    rendered.set(
      token,
      kind === "user"
        ? await renderUser(ctx, id, opts)
        : kind === "event"
          ? await renderEvent(ctx, id)
          : await renderSeries(ctx, id),
    );
  }

  return markdown.replace(MENTION_TOKEN_RE, (token) => rendered.get(token) ?? token);
}

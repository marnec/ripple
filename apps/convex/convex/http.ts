import { createFunctionHandle, httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal, components } from "./_generated/api";
import { auth } from "./auth";
import { handleResendWebhook } from "./emailDelivery";
import { parseTranscriptWebhook } from "./transcriptWebhook";
import { COLLAB_RESOURCES, COLLAB_ROOMS } from "./authHelpers";
import { YJS_SHARE_ROOMS, type YjsShareRoom } from "@ripple/shared/shareTypes";
import type { Id } from "./_generated/dataModel";
import {
  guarded,
  json,
  parseRoomId,
  requireSharedSecret,
  roomIdError,
} from "./httpAdapter";

const http = httpRouter();

/** Every PartyKit route authenticates with the same shared secret. */
const partykitSecret = (request: Request) =>
  requireSharedSecret(request, process.env.PARTYKIT_SECRET, "PARTYKIT_SECRET");

auth.addHttpRoutes(http);

/**
 * Verify a GitHub webhook's `X-Hub-Signature-256` header against the
 * shared secret. Inline because the receiver component's verifyGitHub is
 * not separately exported — and we need HMAC validation BEFORE the
 * freeze pre-check to avoid leaking installation→workspace mapping to
 * unauthenticated callers.
 */
async function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const hex = signatureHeader.replace(/^sha256=/, "");
  if (hex.length !== 64 || /[^0-9a-f]/i.test(hex)) return false;
  const sigBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    sigBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(rawBody),
  );
}

/**
 * POST /integrations/github/webhook
 *
 * Inbound GitHub webhook endpoint. Custom handler instead of the receiver
 * component's `httpHandler` so the freeze pre-check runs BEFORE the
 * dedup-row write — frozen workspaces return 503, GitHub keeps the
 * delivery in its retry window, and when the entitlement is restored
 * the next retry from GitHub lands normally.
 *
 * Pipeline:
 *  1. HMAC verify (rejects unauthenticated callers up-front).
 *  2. Parse `installation.id`; if its workspace is entitlement-frozen,
 *     return 503 without touching the receiver component.
 *  3. Otherwise hand off to `components.webhookReceiver.event.actions.receive`,
 *     which does its own dedup + delivery to `receiveGithubWebhook`.
 *
 * Set the secret with: npx convex env set GITHUB_WEBHOOK_SECRET <value>
 */
http.route({
  path: "/integrations/github/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
    const rawBody = await request.text();
    const sigHeader = request.headers.get("x-hub-signature-256");
    const verified = await verifyGithubSignature(rawBody, sigHeader, secret);
    if (!verified) return new Response("Unauthorized", { status: 401 });

    // Freeze pre-check. Drops the event before any dedup row is written,
    // so GitHub's own retry window keeps re-delivering until the
    // entitlement is restored.
    try {
      const body = JSON.parse(rawBody) as
        | { installation?: { id?: number | string } }
        | undefined;
      const rawId = body?.installation?.id;
      if (rawId !== undefined && rawId !== null) {
        const installationId = String(rawId);
        const frozen = await ctx.runQuery(
          api.integrations.core.entitlements.isInstallationFrozen,
          { installationId },
        );
        if (frozen) {
          return new Response("Service Unavailable (frozen)", { status: 503 });
        }
      }
    } catch {
      // Malformed JSON — fall through and let the receiver record the
      // delivery as failed (HMAC already passed, so this is real traffic).
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const dedupKey = request.headers.get("x-github-delivery") ?? undefined;
    const handlerFunctionHandle = await createFunctionHandle(
      internal.integrations.github.webhook.receiveGithubWebhook,
    );

    const result = await ctx.runAction(
      components.webhookReceiver.event.actions.receive,
      {
        provider: "github",
        rawBody,
        headers,
        handlerFunctionHandle,
        maxAttempts: 3,
        expiresInMs: 30 * 24 * 60 * 60 * 1000,
        ...(dedupKey ? { dedupKey } : {}),
      },
    );

    if (!result.accepted) return new Response("Rejected", { status: 400 });
    return new Response("OK", { status: 200 });
  }),
});

/**
 * POST /integrations/gitlab/webhook
 *
 * Inbound GitLab webhook endpoint. Unlike GitHub there's no central App secret
 * to verify up-front: GitLab webhooks are per-project with a per-hook
 * `X-Gitlab-Token`, so verification happens inside the handler against the
 * resolved link's stored `webhookSecret` (resolve-then-verify). We hand off to
 * the same receiver component for dedup (keyed on `X-Gitlab-Event-UUID`) +
 * delivery to `receiveGitlabWebhook`.
 *
 * There's no entitlement-freeze pre-check (no installation id to resolve a
 * workspace from before dedup); the handler's `effectiveLinkStatus` gate drops
 * frozen/paused deliveries instead.
 */
http.route({
  path: "/integrations/gitlab/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const dedupKey = request.headers.get("x-gitlab-event-uuid") ?? undefined;
    const handlerFunctionHandle = await createFunctionHandle(
      internal.integrations.gitlab.webhook.receiveGitlabWebhook,
    );

    const result = await ctx.runAction(
      components.webhookReceiver.event.actions.receive,
      {
        provider: "gitlab",
        rawBody,
        headers,
        handlerFunctionHandle,
        maxAttempts: 3,
        expiresInMs: 30 * 24 * 60 * 60 * 1000,
        ...(dedupKey ? { dedupKey } : {}),
      },
    );

    if (!result.accepted) return new Response("Rejected", { status: 400 });
    return new Response("OK", { status: 200 });
  }),
});

/**
 * POST /realtime/transcript-webhook?secret=...
 *
 * Cloudflare RealtimeKit `meeting.transcript` webhook. Fires once after a
 * transcribed call's session ends, carrying a short-lived download URL for the
 * consolidated transcript. We resolve the meeting back to its channel and seed
 * a new document from it (`internal.transcripts.ingestTranscript`).
 *
 * Auth: RealtimeKit's webhook signature scheme is undocumented at time of
 * writing, so we gate on a secret token carried in the URL (Cloudflare lets you
 * register an arbitrary webhook URL). Register the hook URL as
 * `https://<convex-site>/realtime/transcript-webhook?secret=<CLOUDFLARE_RTK_WEBHOOK_SECRET>`
 * and set that env var. Any `x-webhook-signature*` header is logged for future
 * hardening once Cloudflare documents the scheme.
 *
 * Set the secret with: npx convex env set CLOUDFLARE_RTK_WEBHOOK_SECRET <value>
 */
http.route({
  path: "/realtime/transcript-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CLOUDFLARE_RTK_WEBHOOK_SECRET ?? "";
    const url = new URL(request.url);
    const provided =
      url.searchParams.get("secret") ??
      request.headers.get("x-webhook-secret") ??
      "";
    if (!secret || provided !== secret) {
      console.error("transcript-webhook: secret mismatch", {
        hasEnvSecret: !!secret,
        providedPresent: !!provided,
      });
      return new Response("Unauthorized", { status: 401 });
    }

    const result = parseTranscriptWebhook(await request.text());
    switch (result.kind) {
      case "malformed":
        return new Response("Bad Request", { status: 400 });
      case "ignore":
        // Ack unrelated events so Cloudflare doesn't retry them.
        return new Response("OK", { status: 200 });
      case "invalid":
        console.error("transcript-webhook: missing required fields");
        return new Response("Bad Request (missing fields)", { status: 400 });
      case "deliver":
        await ctx.scheduler.runAfter(0, internal.transcripts.ingestTranscript, {
          cloudflareMeetingId: result.meetingId,
          cloudflareSessionId: result.sessionId,
          transcriptDownloadUrl: result.transcriptDownloadUrl,
        });
        return new Response("OK", { status: 200 });
    }
  }),
});

/**
 * GET /integrations/github/setup
 *
 * GitHub App "Setup URL" callback. After an admin installs the App, GitHub
 * redirects here with `installation_id`, `state` (our one-time nonce), and
 * `setup_action`. We resolve the nonce → workspace + actor, fetch the
 * installation's account metadata, write the `workspaceIntegrations` row,
 * and redirect the browser back into the app's workspace settings.
 *
 * Always redirects (never returns raw JSON) — this is a user-facing browser
 * navigation. Failures land on `/workspaces` with `?github_install=error`.
 */
http.route({
  path: "/integrations/github/setup",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const siteUrl = process.env.SITE_URL ?? "";
    const url = new URL(request.url);
    const installationId = url.searchParams.get("installation_id");
    const nonce = url.searchParams.get("state");

    const fail = () =>
      Response.redirect(`${siteUrl}/workspaces?github_install=error`, 302);

    if (!installationId || !nonce) return fail();

    const result = await ctx.runAction(
      internal.integrations.github.setupAction.finalizeInstall,
      { installationId, nonce },
    );
    if (!result) return fail();

    return Response.redirect(
      `${siteUrl}/workspaces/${result.workspaceId}/settings?github_install=success`,
      302,
    );
  }),
});

/**
 * GET /integrations/gitlab/oauth/callback
 *
 * GitLab OAuth redirect URI. After the user approves access on GitLab, GitLab
 * redirects here with `code` + our `state` nonce. We hand both to
 * `finalizeOAuth`, which consumes the nonce (one-time), exchanges the code,
 * stores the bundle, and returns the workspace to redirect into.
 *
 * Always redirects — failure lands on `/workspaces` with
 * `?gitlab_oauth=error`. Success lands on the originating workspace's settings.
 */
http.route({
  path: "/integrations/gitlab/oauth/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const siteUrl = process.env.SITE_URL ?? "";
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const nonce = url.searchParams.get("state");

    const fail = () =>
      Response.redirect(`${siteUrl}/workspaces?gitlab_oauth=error`, 302);

    if (!code || !nonce) return fail();

    const result = await ctx.runAction(
      internal.integrations.gitlab.oauthAction.finalizeOAuth,
      { code, nonce },
    );
    if (!result) return fail();

    return Response.redirect(
      `${siteUrl}/workspaces/${result.workspaceId}/settings?gitlab_oauth=success`,
      302,
    );
  }),
});

/**
 * POST /collaboration/snapshot
 *
 * Save a Yjs snapshot from PartyKit to Convex file storage.
 * Called by PartyKit server when persisting document state.
 *
 * Authentication: Shared secret via Authorization: Bearer <PARTYKIT_SECRET>
 * Query params: roomId (format: "{resourceType}-{resourceId}")
 * Body: Binary Yjs snapshot data
 *
 * Response:
 * - 200: { success: true }
 * - 400: Missing roomId
 * - 401: Unauthorized (missing/invalid secret)
 * - 500: Internal server error
 *
 * Note: Requires PARTYKIT_SECRET environment variable to be set.
 * Set via: npx convex env set PARTYKIT_SECRET <value>
 */
http.route({
  path: "/collaboration/snapshot",
  method: "POST",
  handler: httpAction(
    guarded("Snapshot save", async (ctx, request) => {
      const denied = partykitSecret(request);
      if (denied) return denied;

      const url = new URL(request.url);
      const room = parseRoomId(
        url.searchParams.get("roomId"),
        COLLAB_RESOURCES,
      );
      if (room.kind !== "ok") return roomIdError(room);

      const storageId = await ctx.storage.store(await request.blob());

      await ctx.runMutation(internal.snapshots.saveSnapshot, {
        resourceType: room.resourceType,
        resourceId: room.resourceId,
        storageId,
      });

      return json({ success: true });
    }),
  ),
});

/**
 * GET /collaboration/snapshot
 *
 * Load a Yjs snapshot from Convex file storage for PartyKit cold-start hydration.
 * Called by PartyKit server when initializing a room with no in-memory state.
 *
 * Authentication: Shared secret via Authorization: Bearer <PARTYKIT_SECRET>
 * Query params: roomId (format: "{resourceType}-{resourceId}")
 *
 * Response:
 * - 200: Binary Yjs snapshot data (application/octet-stream)
 * - 400: Missing roomId
 * - 401: Unauthorized (missing/invalid secret)
 * - 404: No snapshot found
 * - 500: Internal server error
 */
http.route({
  path: "/collaboration/snapshot",
  method: "GET",
  handler: httpAction(
    guarded("Snapshot load", async (ctx, request) => {
      const denied = partykitSecret(request);
      if (denied) return denied;

      const url = new URL(request.url);
      const room = parseRoomId(
        url.searchParams.get("roomId"),
        COLLAB_RESOURCES,
      );
      if (room.kind !== "ok") return roomIdError(room);

      const storageId = await ctx.runQuery(internal.snapshots.getSnapshot, {
        resourceType: room.resourceType,
        resourceId: room.resourceId,
      });
      if (!storageId) return json({ error: "No snapshot found" }, 404);

      const blob = await ctx.storage.get(storageId);
      if (!blob) return json({ error: "Snapshot file not found" }, 404);

      return new Response(blob, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      });
    }),
  ),
});

/**
 * GET /collaboration/check-access
 *
 * Verify if a user still has access to a collaboration room.
 * Called by PartyKit server for periodic permission re-validation.
 *
 * Authentication: Shared secret via Authorization: Bearer <PARTYKIT_SECRET>
 * Query params:
 *   - roomId (format: "{resourceType}-{resourceId}")
 *   - userId (Convex user document ID)
 *
 * Response:
 * - 200: { hasAccess: true } or { hasAccess: false }
 * - 400: Missing parameters
 * - 401: Unauthorized (missing/invalid secret)
 * - 500: Internal server error
 */
http.route({
  path: "/collaboration/check-access",
  method: "GET",
  handler: httpAction(
    guarded("Permission check", async (ctx, request) => {
      const denied = partykitSecret(request);
      if (denied) return denied;

      const url = new URL(request.url);
      const userId = url.searchParams.get("userId");
      const shareId = url.searchParams.get("shareId");
      if (!userId) return json({ error: "Missing userId" }, 400);

      const room = parseRoomId(url.searchParams.get("roomId"), COLLAB_ROOMS);
      if (room.kind !== "ok") return roomIdError(room);

      // Guest connections carry a shareId and a `guest:<nanoid>` userId —
      // re-validate against the share row rather than workspace membership.
      if (userId.startsWith("guest:")) {
        const shareable = (YJS_SHARE_ROOMS as string[]).includes(
          room.resourceType,
        );
        if (!shareable || !shareId) return json({ hasAccess: false });

        const hasAccess = await ctx.runQuery(internal.shares.checkGuestAccess, {
          shareId,
          resourceType: room.resourceType as YjsShareRoom,
          resourceId: room.resourceId,
        });
        return json({ hasAccess });
      }

      const hasAccess = await ctx.runQuery(internal.collaboration.checkAccess, {
        userId: userId as Id<"users">,
        resourceType: room.resourceType,
        resourceId: room.resourceId,
      });

      return json({ hasAccess });
    }),
  ),
});

/**
 * POST /collaboration/cell-values
 *
 * Push updated cell values from PartyKit when spreadsheet data changes.
 * Called by PartyKit server with debounced batches of changed cells.
 *
 * Authentication: Shared secret via Authorization: Bearer <PARTYKIT_SECRET>
 * Body: { spreadsheetId: string, updates: Array<{ cellRef: string, values: string }> }
 *
 * Response:
 * - 200: { success: true }
 * - 401: Unauthorized
 * - 500: Internal server error
 */
http.route({
  path: "/collaboration/cell-values",
  method: "POST",
  handler: httpAction(
    guarded("Cell values update", async (ctx, request) => {
      const denied = partykitSecret(request);
      if (denied) return denied;

      const body = (await request.json()) as {
        spreadsheetId: string;
        updates: Array<{
          stableRef: string;
          liveCellRef?: string;
          values: string;
          orphan?: boolean;
        }>;
      };

      if (!body.spreadsheetId || !Array.isArray(body.updates)) {
        return json({ error: "Invalid request body" }, 400);
      }

      await ctx.runMutation(internal.spreadsheetCellRefs.upsertCellValues, {
        spreadsheetId: body.spreadsheetId as Id<"spreadsheets">,
        updates: body.updates,
      });

      return json({ success: true });
    }),
  ),
});

/**
 * GET /collaboration/cell-refs
 *
 * Get list of tracked cell references for a spreadsheet.
 * Called by PartyKit to know which cells to monitor and push updates for.
 *
 * Authentication: Shared secret via Authorization: Bearer <PARTYKIT_SECRET>
 * Query params: spreadsheetId
 *
 * Response:
 * - 200: Array<{ cellRef: string }>
 * - 401: Unauthorized
 * - 500: Internal server error
 */
http.route({
  path: "/collaboration/cell-refs",
  method: "GET",
  handler: httpAction(
    guarded("Cell refs query", async (ctx, request) => {
      const denied = partykitSecret(request);
      if (denied) return denied;

      const url = new URL(request.url);
      const spreadsheetId = url.searchParams.get("spreadsheetId");
      if (!spreadsheetId) return json({ error: "Missing spreadsheetId" }, 400);

      const refs = await ctx.runQuery(
        internal.spreadsheetCellRefs.getReferencedCellRefs,
        { spreadsheetId: spreadsheetId as Id<"spreadsheets"> },
      );

      return json(refs);
    }),
  ),
});

/**
 * GET /collaboration/block-refs
 *
 * Get list of tracked document block references for a document.
 * Called by PartyKit to know which blocks to monitor and push updates for.
 */
http.route({
  path: "/collaboration/block-refs",
  method: "GET",
  handler: httpAction(
    guarded("Block refs query", async (ctx, request) => {
      const denied = partykitSecret(request);
      if (denied) return denied;

      const url = new URL(request.url);
      const documentId = url.searchParams.get("documentId");
      if (!documentId) return json({ error: "Missing documentId" }, 400);

      const refs = await ctx.runQuery(
        internal.documentBlockRefs.getReferencedBlockRefs,
        { documentId: documentId as Id<"documents"> },
      );

      return json(refs);
    }),
  ),
});

/**
 * POST /collaboration/block-content
 *
 * Push updated block content from PartyKit when document text changes.
 * Called by PartyKit server with debounced batches of changed blocks.
 */
http.route({
  path: "/collaboration/block-content",
  method: "POST",
  handler: httpAction(
    guarded("Block content update", async (ctx, request) => {
      const denied = partykitSecret(request);
      if (denied) return denied;

      const body = (await request.json()) as {
        documentId: string;
        updates: Array<{
          blockId: string;
          blockType: string;
          textContent: string;
        }>;
      };

      if (!body.documentId || !Array.isArray(body.updates)) {
        return json({ error: "Invalid request body" }, 400);
      }

      await ctx.runMutation(internal.documentBlockRefs.upsertBlockContent, {
        documentId: body.documentId as Id<"documents">,
        updates: body.updates,
      });

      return json({ success: true });
    }),
  ),
});

/**
 * POST /calendar/rsvp
 *
 * Inbound ICS RSVP from the rsvp-worker (packages/rsvp-worker). Called when
 * a recipient clicks Yes / Maybe / No on the calendar card their mail client
 * rendered, the worker parses the resulting METHOD:REPLY ICS, verifies
 * authenticity (DKIM + DMARC + From-vs-ATTENDEE), and forwards it here.
 *
 * Authentication: Shared secret via Authorization: Bearer <RSVP_WORKER_SECRET>
 * Body (JSON): { uid, attendeeEmail, partstat, dtstamp, sequence }
 *   - uid: ${eventId}@${EMAIL_RSVP_DOMAIN} (built by emails.ts `eventUid()`)
 *   - partstat: "ACCEPTED" | "DECLINED" | "TENTATIVE"
 *   - dtstamp, sequence: numbers (idempotency keys)
 *
 * Response:
 * - 200: { ok: true, applied: boolean, reason?: "stale" | "unknown_event"
 *         | "unknown_attendee" | "event_cancelled" }
 * - 400: Invalid body
 * - 401: Unauthorized
 * - 500: Internal error
 *
 * Note: requires RSVP_WORKER_SECRET set via
 *   `npx convex env set RSVP_WORKER_SECRET <value>`
 * (same value as the Cloudflare Worker secret of the same name).
 */
http.route({
  path: "/calendar/rsvp",
  method: "POST",
  handler: httpAction(
    guarded("RSVP ingest", async (ctx, request) => {
      const denied = requireSharedSecret(
        request,
        process.env.RSVP_WORKER_SECRET,
        "RSVP_WORKER_SECRET",
      );
      if (denied) return denied;

      const body = (await request.json()) as Partial<{
        uid: string;
        attendeeEmail: string;
        partstat: "ACCEPTED" | "DECLINED" | "TENTATIVE";
        dtstamp: number;
        sequence: number;
      }>;

      if (
        typeof body.uid !== "string" ||
        typeof body.attendeeEmail !== "string" ||
        (body.partstat !== "ACCEPTED" &&
          body.partstat !== "DECLINED" &&
          body.partstat !== "TENTATIVE") ||
        typeof body.dtstamp !== "number" ||
        typeof body.sequence !== "number"
      ) {
        return json({ error: "Invalid body" }, 400);
      }

      const result = await ctx.runMutation(
        internal.calendarEventInvitees.recordEmailRsvp,
        {
          uid: body.uid,
          attendeeEmail: body.attendeeEmail,
          partstat: body.partstat,
          dtstamp: body.dtstamp,
          sequence: body.sequence,
        },
      );

      return json({ ok: true, ...result });
    }),
  ),
});

/**
 * POST /resend-webhook
 *
 * Resend's delivery events (sent / delivered / bounced / complained / …). The
 * component verifies the Svix signature against `RESEND_WEBHOOK_SECRET` itself
 * and updates its own email records, then calls `emailEvents.recordEmailEvent`.
 *
 * Deliberately NOT behind the `httpAdapter` helpers the PartyKit routes share:
 * those authenticate a caller *we* configured with a bearer secret, while this
 * one is signature-verified by the component from the raw request body — the
 * adapter's `json()` / `requireSharedSecret` would have nothing to do and
 * reading the body here would consume it before the verifier sees it. Same
 * reasoning as the GitHub webhook route above.
 */
http.route({
  path: "/resend-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    return await handleResendWebhook(ctx, request);
  }),
});

export default http;

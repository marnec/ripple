import { createFunctionHandle, httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal, components } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

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
  handler: httpAction(async (ctx, request) => {
    try {
      // Validate shared secret
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = process.env.PARTYKIT_SECRET;

      if (!expectedSecret) {
        console.error(
          "PARTYKIT_SECRET environment variable not configured"
        );
        return new Response(
          JSON.stringify({ error: "Server configuration error" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const providedSecret = authHeader.substring(7); // Remove "Bearer "
      if (providedSecret !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Extract roomId from query params
      const url = new URL(request.url);
      const roomId = url.searchParams.get("roomId");

      if (!roomId) {
        return new Response(JSON.stringify({ error: "Missing roomId" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Parse roomId to extract resourceType and resourceId
      // Format: "{resourceType}-{resourceId}"
      const dashIndex = roomId.indexOf("-");
      if (dashIndex === -1) {
        return new Response(
          JSON.stringify({ error: "Invalid roomId format" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const resourceType = roomId.substring(0, dashIndex);
      const resourceId = roomId.substring(dashIndex + 1);

      // Validate resource type
      if (
        resourceType !== "doc" &&
        resourceType !== "diagram" &&
        resourceType !== "task" &&
        resourceType !== "spreadsheet"
      ) {
        return new Response(
          JSON.stringify({ error: "Invalid resource type" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Read binary snapshot data
      const blob = await request.blob();

      // Store in Convex file storage
      const storageId = await ctx.storage.store(blob);

      // Save snapshot reference to resource
      await ctx.runMutation(internal.snapshots.saveSnapshot, {
        resourceType,
        resourceId,
        storageId,
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Snapshot save error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }),
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
  handler: httpAction(async (ctx, request) => {
    try {
      // Validate shared secret
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = process.env.PARTYKIT_SECRET;

      if (!expectedSecret) {
        console.error(
          "PARTYKIT_SECRET environment variable not configured"
        );
        return new Response(
          JSON.stringify({ error: "Server configuration error" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const providedSecret = authHeader.substring(7); // Remove "Bearer "
      if (providedSecret !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Extract roomId from query params
      const url = new URL(request.url);
      const roomId = url.searchParams.get("roomId");

      if (!roomId) {
        return new Response(JSON.stringify({ error: "Missing roomId" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Parse roomId to extract resourceType and resourceId
      const dashIndex = roomId.indexOf("-");
      if (dashIndex === -1) {
        return new Response(
          JSON.stringify({ error: "Invalid roomId format" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const resourceType = roomId.substring(0, dashIndex);
      const resourceId = roomId.substring(dashIndex + 1);

      // Validate resource type
      if (
        resourceType !== "doc" &&
        resourceType !== "diagram" &&
        resourceType !== "task" &&
        resourceType !== "spreadsheet"
      ) {
        return new Response(
          JSON.stringify({ error: "Invalid resource type" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Get snapshot storage ID
      const storageId = await ctx.runQuery(internal.snapshots.getSnapshot, {
        resourceType,
        resourceId,
      });

      if (!storageId) {
        return new Response(JSON.stringify({ error: "No snapshot found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Retrieve blob from storage
      const blob = await ctx.storage.get(storageId);

      if (!blob) {
        return new Response(
          JSON.stringify({ error: "Snapshot file not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Return binary snapshot data
      return new Response(blob, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      });
    } catch (error) {
      console.error("Snapshot load error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }),
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
  handler: httpAction(async (ctx, request) => {
    try {
      // Validate shared secret
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = process.env.PARTYKIT_SECRET;

      if (!expectedSecret) {
        console.error(
          "PARTYKIT_SECRET environment variable not configured"
        );
        return new Response(
          JSON.stringify({ error: "Server configuration error" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const providedSecret = authHeader.substring(7); // Remove "Bearer "
      if (providedSecret !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Extract query params
      const url = new URL(request.url);
      const roomId = url.searchParams.get("roomId");
      const userId = url.searchParams.get("userId");
      const shareId = url.searchParams.get("shareId");

      if (!roomId || !userId) {
        return new Response(
          JSON.stringify({ error: "Missing roomId or userId" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Parse roomId to extract resourceType and resourceId
      const dashIndex = roomId.indexOf("-");
      if (dashIndex === -1) {
        return new Response(
          JSON.stringify({ error: "Invalid roomId format" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const resourceType = roomId.substring(0, dashIndex);
      const resourceId = roomId.substring(dashIndex + 1);

      // Validate resource type
      if (
        resourceType !== "doc" &&
        resourceType !== "diagram" &&
        resourceType !== "task" &&
        resourceType !== "presence" &&
        resourceType !== "spreadsheet"
      ) {
        return new Response(
          JSON.stringify({ error: "Invalid resource type" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Guest connections carry a shareId and a `guest:<nanoid>` userId —
      // re-validate against the share row rather than workspace membership.
      if (userId.startsWith("guest:")) {
        if (
          resourceType !== "doc" &&
          resourceType !== "diagram" &&
          resourceType !== "spreadsheet"
        ) {
          return new Response(JSON.stringify({ hasAccess: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (!shareId) {
          return new Response(JSON.stringify({ hasAccess: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        const hasAccess = await ctx.runQuery(
          internal.shares.checkGuestAccess,
          {
            shareId,
            resourceType,
            resourceId,
          },
        );
        return new Response(JSON.stringify({ hasAccess }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Check if user has access
      const hasAccess = await ctx.runQuery(internal.collaboration.checkAccess, {
        userId: userId as any,
        resourceType: resourceType as any,
        resourceId,
      });

      return new Response(JSON.stringify({ hasAccess }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Permission check error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }),
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
  handler: httpAction(async (ctx, request) => {
    try {
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = process.env.PARTYKIT_SECRET;

      if (!expectedSecret) {
        console.error("PARTYKIT_SECRET environment variable not configured");
        return new Response(
          JSON.stringify({ error: "Server configuration error" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      const providedSecret = authHeader.substring(7);
      if (providedSecret !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

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
        return new Response(
          JSON.stringify({ error: "Invalid request body" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      await ctx.runMutation(internal.spreadsheetCellRefs.upsertCellValues, {
        spreadsheetId: body.spreadsheetId as any,
        updates: body.updates,
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Cell values update error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
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
  handler: httpAction(async (ctx, request) => {
    try {
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = process.env.PARTYKIT_SECRET;

      if (!expectedSecret) {
        console.error("PARTYKIT_SECRET environment variable not configured");
        return new Response(
          JSON.stringify({ error: "Server configuration error" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      const providedSecret = authHeader.substring(7);
      if (providedSecret !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const url = new URL(request.url);
      const spreadsheetId = url.searchParams.get("spreadsheetId");

      if (!spreadsheetId) {
        return new Response(
          JSON.stringify({ error: "Missing spreadsheetId" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const refs = await ctx.runQuery(
        internal.spreadsheetCellRefs.getReferencedCellRefs,
        { spreadsheetId: spreadsheetId as any },
      );

      return new Response(JSON.stringify(refs), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Cell refs query error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
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
  handler: httpAction(async (ctx, request) => {
    try {
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = process.env.PARTYKIT_SECRET;

      if (!expectedSecret || !authHeader || authHeader.substring(7) !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const url = new URL(request.url);
      const documentId = url.searchParams.get("documentId");

      if (!documentId) {
        return new Response(
          JSON.stringify({ error: "Missing documentId" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const refs = await ctx.runQuery(
        internal.documentBlockRefs.getReferencedBlockRefs,
        { documentId: documentId as any },
      );

      return new Response(JSON.stringify(refs), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Block refs query error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
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
  handler: httpAction(async (ctx, request) => {
    try {
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = process.env.PARTYKIT_SECRET;

      if (!expectedSecret || !authHeader || authHeader.substring(7) !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = (await request.json()) as {
        documentId: string;
        updates: Array<{ blockId: string; blockType: string; textContent: string }>;
      };

      if (!body.documentId || !Array.isArray(body.updates)) {
        return new Response(
          JSON.stringify({ error: "Invalid request body" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      await ctx.runMutation(internal.documentBlockRefs.upsertBlockContent, {
        documentId: body.documentId as any,
        updates: body.updates,
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Block content update error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
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
  handler: httpAction(async (ctx, request) => {
    try {
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = process.env.RSVP_WORKER_SECRET;

      if (!expectedSecret) {
        console.error("RSVP_WORKER_SECRET environment variable not configured");
        return new Response(
          JSON.stringify({ error: "Server configuration error" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }

      if (
        !authHeader ||
        !authHeader.startsWith("Bearer ") ||
        authHeader.substring(7) !== expectedSecret
      ) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

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
        return new Response(JSON.stringify({ error: "Invalid body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
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

      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("RSVP ingest error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
});

export default http;

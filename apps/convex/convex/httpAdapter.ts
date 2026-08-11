/**
 * The adapter the machine-to-machine HTTP routes in `http.ts` sit behind: the
 * shared-secret check, the roomId parse and the JSON response shaping that each
 * route used to re-derive inline. Free of any Convex deps so the routes (default
 * runtime) can import it and it's unit-testable in isolation — see
 * `tests/httpAdapter.test.ts`.
 */

export type ParseRoomIdResult<T extends string> =
  | { kind: "ok"; resourceType: T; resourceId: string }
  | { kind: "missing" }
  | { kind: "malformed" }
  | { kind: "forbidden-type" };

export function parseRoomId<T extends string>(
  roomId: string | null,
  allowed: readonly T[],
): ParseRoomIdResult<T> {
  if (!roomId) return { kind: "missing" };
  const dashIndex = roomId.indexOf("-");
  if (dashIndex === -1) return { kind: "malformed" };
  const resourceType = roomId.substring(0, dashIndex);
  if (!(allowed as readonly string[]).includes(resourceType)) {
    return { kind: "forbidden-type" };
  }
  return {
    kind: "ok",
    resourceType: resourceType as T,
    resourceId: roomId.substring(dashIndex + 1),
  };
}

const BEARER_PREFIX = "Bearer ";

export type SharedSecretResult =
  | { kind: "ok" }
  | { kind: "unconfigured" }
  | { kind: "unauthorized" };

export function checkSharedSecret(
  authHeader: string | null,
  expectedSecret: string | undefined,
): SharedSecretResult {
  if (!expectedSecret) return { kind: "unconfigured" };
  if (!authHeader?.startsWith(BEARER_PREFIX)) return { kind: "unauthorized" };
  if (authHeader.substring(BEARER_PREFIX.length) !== expectedSecret) {
    return { kind: "unauthorized" };
  }
  return { kind: "ok" };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The shared-secret gate as a route uses it: `null` means "carry on", anything
 * else is the response to return. `secretName` only ever reaches the server log
 * — an unauthenticated caller is told "Unauthorized" and nothing more.
 */
export function requireSharedSecret(
  request: Request,
  expectedSecret: string | undefined,
  secretName: string,
): Response | null {
  const result = checkSharedSecret(
    request.headers.get("Authorization"),
    expectedSecret,
  );
  switch (result.kind) {
    case "ok":
      return null;
    case "unconfigured":
      console.error(`${secretName} environment variable not configured`);
      return json({ error: "Server configuration error" }, 500);
    case "unauthorized":
      return json({ error: "Unauthorized" }, 401);
  }
}

/** The 400 for a roomId that didn't parse. */
export function roomIdError(
  result: Exclude<ParseRoomIdResult<string>, { kind: "ok" }>,
): Response {
  switch (result.kind) {
    case "missing":
      return json({ error: "Missing roomId" }, 400);
    case "malformed":
      return json({ error: "Invalid roomId format" }, 400);
    case "forbidden-type":
      return json({ error: "Invalid resource type" }, 400);
  }
}

/**
 * Wrap a route handler so an unexpected throw becomes a logged 500 rather than
 * a raw stack trace on the wire. Generic in `Ctx` to keep this module free of
 * Convex imports; at the call site `httpAction` supplies the concrete type.
 */
export function guarded<Ctx>(
  label: string,
  handler: (ctx: Ctx, request: Request) => Promise<Response>,
): (ctx: Ctx, request: Request) => Promise<Response> {
  return async (ctx, request) => {
    try {
      return await handler(ctx, request);
    } catch (error) {
      console.error(`${label} error:`, error);
      return json({ error: "Internal server error" }, 500);
    }
  };
}

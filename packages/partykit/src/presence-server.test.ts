import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real `partyserver` base class imports `cloudflare:workers`, which the
 * node test runner cannot resolve — so the Durable Object plumbing PresenceServer
 * inherits (name, env, storage alarms, the connection set, broadcast) is stubbed
 * here. Everything under test is PresenceServer's own code.
 */
vi.mock("partyserver", () => {
  class Server {
    name = "";
    env: Record<string, string> = {};
    ctx = { storage: { setAlarm: vi.fn(async (_at: number) => {}) } };
    connections = new Map<string, FakeConnection>();

    getConnections() {
      return this.connections.values();
    }

    broadcast(message: string, without: string[] = []) {
      for (const conn of this.connections.values()) {
        if (without.includes(conn.id)) continue;
        conn.sent.push(message);
      }
    }
  }
  return { Server };
});

const PresenceServer = (await import("./presence-server")).default;

const SECRET = "test-secret";
const WORKSPACE = "ws-1";

class FakeConnection {
  sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  state: unknown = undefined;

  constructor(readonly id: string) {}

  setState(state: unknown) {
    this.state = state;
  }

  send(message: string) {
    this.sent.push(message);
  }

  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
}

interface Harness {
  name: string;
  env: Record<string, string>;
  ctx: { storage: { setAlarm: ReturnType<typeof vi.fn> } };
  connections: Map<string, FakeConnection>;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mirror of `convex/tokenSigning.ts` — enough to satisfy `verifyToken`. */
async function signToken(payload: Record<string, unknown>): Promise<string> {
  const payloadB64 = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64),
  );
  return `${payloadB64}.${base64url(new Uint8Array(signature))}`;
}

function createServer() {
  const server = new (PresenceServer as unknown as new () => InstanceType<
    typeof PresenceServer
  >)();
  const harness = server as unknown as Harness;
  harness.name = WORKSPACE;
  harness.env = {
    CONVEX_SITE_URL: "https://convex.example",
    PARTYKIT_SECRET: SECRET,
  };
  return { server, harness };
}

/** Connect a user the way the worker does, then report a location. */
async function connect(
  server: InstanceType<typeof PresenceServer>,
  harness: Harness,
  userId: string,
): Promise<FakeConnection> {
  const conn = new FakeConnection(`conn-${userId}`);
  harness.connections.set(conn.id, conn);

  const token = await signToken({
    sub: userId,
    name: userId,
    img: null,
    room: `presence-${WORKSPACE}`,
    exp: Date.now() + 300_000,
  });

  await server.onConnect(conn as never, {
    request: new Request(`https://party.example/?token=${token}`),
  } as never);

  server.onMessage(
    conn as never,
    JSON.stringify({ type: "presence_update", currentPath: `/p/${userId}` }),
  );
  // Drop the join traffic (snapshot + the presence_changed it fans out) so
  // assertions read only what the permission tick produced.
  for (const other of harness.connections.values()) other.sent.length = 0;
  return conn;
}

function parsed(conn: FakeConnection): Array<{ type: string; userId?: string }> {
  return conn.sent.map((raw) => JSON.parse(raw));
}

/** hasAccess for every user except those named. */
function fetchDenying(...deniedUsers: string[]) {
  return vi.fn((input: string) => {
    const url = new URL(input);
    const userId = url.searchParams.get("userId") ?? "";
    return Promise.resolve(
      new Response(JSON.stringify({ hasAccess: !deniedUsers.includes(userId) }), {
        status: 200,
      }),
    );
  });
}

describe("PresenceServer permission re-validation", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("schedules exactly one permission-check alarm for the room", async () => {
    vi.stubGlobal("fetch", fetchDenying());
    const { server, harness } = createServer();

    await connect(server, harness, "user-a");
    expect(harness.ctx.storage.setAlarm).toHaveBeenCalledTimes(1);

    // A second tab joins an already-watched room — no second alarm.
    await connect(server, harness, "user-b");
    expect(harness.ctx.storage.setAlarm).toHaveBeenCalledTimes(1);
  });

  it("closes a revoked member's live connection and retires them from the room", async () => {
    const fetchMock = fetchDenying("user-b");
    vi.stubGlobal("fetch", fetchMock);
    const { server, harness } = createServer();

    const connA = await connect(server, harness, "user-a");
    const connB = await connect(server, harness, "user-b");

    await server.onAlarm();

    // The check addresses the presence room, not a bare workspace id.
    const checked = fetchMock.mock.calls.map(([input]) => new URL(input as string));
    expect(checked.map((u) => u.searchParams.get("roomId"))).toEqual([
      `presence-${WORKSPACE}`,
      `presence-${WORKSPACE}`,
    ]);
    expect(checked.map((u) => u.searchParams.get("userId"))).toEqual([
      "user-a",
      "user-b",
    ]);

    expect(connB.closed).toEqual({ code: 1008, reason: "AUTH_FORBIDDEN" });
    expect(parsed(connB).map((m) => m.type)).toEqual(["permission_revoked"]);

    // …and everyone else stops seeing where they were.
    expect(parsed(connA)).toEqual([
      { type: "user_left_presence", userId: "user-b" },
    ]);

    // The still-authorized member is untouched.
    expect(connA.closed).toBeNull();
  });

  it("leaves connections alone when the access check itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))),
    );
    const { server, harness } = createServer();
    const conn = await connect(server, harness, "user-a");

    await server.onAlarm();

    expect(conn.closed).toBeNull();
    expect(conn.sent).toEqual([]);
  });

  it("keeps ticking while the room is occupied and stops once it empties", async () => {
    vi.stubGlobal("fetch", fetchDenying());
    const { server, harness } = createServer();
    await connect(server, harness, "user-a");
    harness.ctx.storage.setAlarm.mockClear();

    await server.onAlarm();
    expect(harness.ctx.storage.setAlarm).toHaveBeenCalledTimes(1);

    harness.connections.clear();
    await server.onAlarm();
    expect(harness.ctx.storage.setAlarm).toHaveBeenCalledTimes(1);

    // …and a later join restarts the loop.
    await connect(server, harness, "user-c");
    expect(harness.ctx.storage.setAlarm).toHaveBeenCalledTimes(2);
  });

  it("does not fire the loop when the server is missing its Convex config", async () => {
    const fetchMock = fetchDenying("user-a");
    vi.stubGlobal("fetch", fetchMock);
    const { server, harness } = createServer();
    const conn = await connect(server, harness, "user-a");
    harness.env = { PARTYKIT_SECRET: SECRET };

    await server.onAlarm();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(conn.closed).toBeNull();
  });
});

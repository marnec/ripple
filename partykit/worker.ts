import { routePartykitRequest } from "partyserver";
import { verifyToken } from "./token-utils";

export { default as Main } from "./server";
export { default as Presence } from "./presence-server";

interface Env {
  Main: DurableObjectNamespace;
  Presence: DurableObjectNamespace;
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  CONVEX_SITE_URL: string;
  PARTYKIT_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Route PartyKit WebSocket/HTTP requests.
    // onBeforeConnect verifies auth BEFORE the WebSocket upgrade so that
    // rejected connections never trigger onopen → backoff-reset in y-websocket.
    const partyResponse = await routePartykitRequest(request, env, {
      async onBeforeConnect(req, lobby) {
        // Only Main DO needs auth (Presence verifies in onConnect)
        if (lobby.className !== "Main") return;

        const url = new URL(req.url);
        const token = url.searchParams.get("token");
        if (!token) {
          console.warn(`[onBeforeConnect] Missing token for room ${lobby.name}`);
          return new Response("Missing token", { status: 401 });
        }

        const secret = env.PARTYKIT_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });

        // Verify HMAC-signed token locally — no callback to Convex needed
        const userData = await verifyToken(token, secret);
        if (!userData) {
          console.warn(`[onBeforeConnect] Auth rejected for room ${lobby.name}`);
          return new Response("Unauthorized", { status: 401 });
        }

        if (userData.roomId !== lobby.name) {
          console.warn(`[onBeforeConnect] Room mismatch: token=${userData.roomId} lobby=${lobby.name}`);
          return new Response("Room mismatch", { status: 403 });
        }

        // Forward verified user data to the DO via headers
        const headers = new Headers(req.headers);
        headers.set("X-Verified-User-Id", userData.userId);
        headers.set("X-Verified-User-Name", userData.userName);
        headers.set("X-Verified-User-Image", userData.userImage ?? "");
        if (userData.isGuest) {
          headers.set("X-Verified-Is-Guest", "1");
          if (userData.accessLevel) {
            headers.set("X-Verified-Access-Level", userData.accessLevel);
          }
          if (userData.shareId) {
            headers.set("X-Verified-Share-Id", userData.shareId);
          }
        }
        return new Request(req, { headers });
      },
    });
    if (partyResponse) return partyResponse;

    // Fall through to static assets (prod only, via ASSETS binding)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};

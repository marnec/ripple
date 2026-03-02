import { routePartykitRequest } from "partyserver";

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
        // Only Main DO needs auth (Presence is unauthenticated)
        if (lobby.className !== "Main") return;

        const url = new URL(req.url);
        const token = url.searchParams.get("token");
        if (!token) {
          console.warn(`[onBeforeConnect] Missing token for room ${lobby.name}`);
          return new Response("Missing token", { status: 401 });
        }

        const convexSiteUrl = env.CONVEX_SITE_URL;
        if (!convexSiteUrl) return new Response("Server misconfigured", { status: 500 });

        const response = await fetch(`${convexSiteUrl}/collaboration/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ roomId: lobby.name }),
        });

        if (!response.ok) {
          console.warn(`[onBeforeConnect] Auth rejected for room ${lobby.name}: ${response.status}`);
          return new Response("Unauthorized", { status: 401 });
        }

        const userData = (await response.json()) as {
          userId: string;
          userName: string;
        };

        // Forward verified user data to the DO via headers
        const headers = new Headers(req.headers);
        headers.set("X-Verified-User-Id", userData.userId);
        headers.set("X-Verified-User-Name", userData.userName ?? "");
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

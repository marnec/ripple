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
    // Route PartyKit WebSocket/HTTP requests
    const partyResponse = await routePartykitRequest(request, env);
    if (partyResponse) return partyResponse;

    // Fall through to static assets (prod only, via ASSETS binding)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};

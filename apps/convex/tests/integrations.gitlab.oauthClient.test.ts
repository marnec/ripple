import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  createProjectHook,
  deriveCodeChallenge,
  exchangeCodeForToken,
  generateCodeVerifier,
  fetchCurrentUser,
  listProjects,
  refreshAccessToken,
} from "../convex/integrations/gitlab/oauthClient";

/**
 * Pure-HTTP tests for the OAuth client. Every test injects a fetch fake; no
 * Convex context required. Covers: PKCE derivation, authorize URL shape,
 * code/refresh token exchange, current-user lookup, project list, and project
 * webhook registration — the surface the OAuth flow + token refresh seam +
 * project picker all depend on.
 */
const cfg = {
  clientId: "cid",
  clientSecret: "csec",
  redirectUri: "https://app.example/integrations/gitlab/oauth/callback",
  base: "https://gitlab.test",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("oauthClient — PKCE", () => {
  it("derives the same S256 challenge as RFC 7636's worked example", async () => {
    // Verifier from RFC 7636 Appendix B; challenge is its SHA-256 base64url-encoded.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(await deriveCodeChallenge(verifier)).toBe(expected);
  });

  it("generateCodeVerifier returns 43+ char base64url strings", () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43);
  });
});

describe("oauthClient.buildAuthorizeUrl", () => {
  it("encodes all required PKCE + state params", () => {
    const url = new URL(
      buildAuthorizeUrl({
        cfg,
        state: "nonce-123",
        codeChallenge: "chall-abc",
      }),
    );
    expect(url.origin + url.pathname).toBe(`${cfg.base}/oauth/authorize`);
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("nonce-123");
    expect(url.searchParams.get("scope")).toBe("api");
    expect(url.searchParams.get("code_challenge")).toBe("chall-abc");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("oauthClient.exchangeCodeForToken", () => {
  it("POSTs form-encoded creds + code + verifier and returns bundle with derived expiresAt", async () => {
    let captured: { url: string; body: string } | null = null;
    const fetchImpl: typeof fetch = async (url, init) => {
      captured = { url: String(url), body: String(init?.body ?? "") };
      return jsonResponse(200, {
        access_token: "at-1",
        refresh_token: "rt-1",
        expires_in: 7200,
      });
    };
    const before = Date.now();
    const bundle = await exchangeCodeForToken({
      cfg: { ...cfg, fetchImpl },
      code: "auth-code-xyz",
      codeVerifier: "verify-pkce",
    });
    const after = Date.now();

    expect(captured).not.toBeNull();
    expect(captured!.url).toBe(`${cfg.base}/oauth/token`);
    const params = new URLSearchParams(captured!.body);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("auth-code-xyz");
    expect(params.get("code_verifier")).toBe("verify-pkce");
    expect(params.get("client_id")).toBe("cid");
    expect(params.get("client_secret")).toBe("csec");
    expect(params.get("redirect_uri")).toBe(cfg.redirectUri);

    expect(bundle.accessToken).toBe("at-1");
    expect(bundle.refreshToken).toBe("rt-1");
    expect(bundle.expiresAt).toBeGreaterThanOrEqual(before + 7200 * 1000);
    expect(bundle.expiresAt).toBeLessThanOrEqual(after + 7200 * 1000);
  });

  it("throws on non-2xx", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("invalid_grant", { status: 400 });
    await expect(
      exchangeCodeForToken({
        cfg: { ...cfg, fetchImpl },
        code: "x",
        codeVerifier: "y",
      }),
    ).rejects.toThrow(/token exchange failed/);
  });

  it("falls back to 2h expiry when expires_in is missing", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse(200, { access_token: "a", refresh_token: "r" });
    const before = Date.now();
    const bundle = await exchangeCodeForToken({
      cfg: { ...cfg, fetchImpl },
      code: "x",
      codeVerifier: "y",
    });
    expect(bundle.expiresAt).toBeGreaterThanOrEqual(before + 7200 * 1000 - 5);
  });
});

describe("oauthClient.refreshAccessToken", () => {
  it("POSTs grant_type=refresh_token and returns the new bundle (rotated refresh)", async () => {
    let captured = "";
    const fetchImpl: typeof fetch = async (_url, init) => {
      captured = String(init?.body ?? "");
      return jsonResponse(200, {
        access_token: "at-2",
        refresh_token: "rt-2",
        expires_in: 3600,
      });
    };
    const bundle = await refreshAccessToken({
      cfg: { ...cfg, fetchImpl },
      refreshToken: "rt-1",
    });
    const params = new URLSearchParams(captured);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("rt-1");
    expect(bundle.accessToken).toBe("at-2");
    expect(bundle.refreshToken).toBe("rt-2");
  });
});

describe("oauthClient.fetchCurrentUser", () => {
  it("GETs /api/v4/user with Bearer auth and extracts id+username", async () => {
    let capturedAuth = "";
    let capturedUrl = "";
    const fetchImpl: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      const headers = new Headers(init?.headers ?? {});
      capturedAuth = headers.get("Authorization") ?? "";
      return jsonResponse(200, { id: 99, username: "octocat" });
    };
    const u = await fetchCurrentUser({
      cfg: { ...cfg, fetchImpl },
      accessToken: "at",
    });
    expect(capturedUrl).toBe(`${cfg.base}/api/v4/user`);
    expect(capturedAuth).toBe("Bearer at");
    expect(u).toEqual({ id: 99, username: "octocat" });
  });
});

describe("oauthClient.listProjects", () => {
  it("filters to membership + min_access_level 40 and returns normalized rows", async () => {
    let capturedUrl = "";
    const fetchImpl: typeof fetch = async (url) => {
      capturedUrl = String(url);
      return jsonResponse(200, [
        {
          id: 11,
          path_with_namespace: "acme/web",
          default_branch: "main",
          web_url: "https://gitlab.test/acme/web",
        },
        {
          id: 12,
          path_with_namespace: "acme/api",
          default_branch: null,
          web_url: "https://gitlab.test/acme/api",
        },
      ]);
    };
    const rows = await listProjects({
      cfg: { ...cfg, fetchImpl },
      accessToken: "at",
      page: 2,
      perPage: 50,
      search: "we",
    });
    const url = new URL(capturedUrl);
    expect(url.searchParams.get("membership")).toBe("true");
    expect(url.searchParams.get("min_access_level")).toBe("40");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("per_page")).toBe("50");
    expect(url.searchParams.get("search")).toBe("we");
    expect(rows).toEqual([
      {
        id: 11,
        pathWithNamespace: "acme/web",
        defaultBranch: "main",
        webUrl: "https://gitlab.test/acme/web",
      },
      {
        id: 12,
        pathWithNamespace: "acme/api",
        defaultBranch: null,
        webUrl: "https://gitlab.test/acme/api",
      },
    ]);
  });
});

describe("oauthClient.createProjectHook", () => {
  it("POSTs the hook config with all the right event flags", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      return jsonResponse(201, { id: 555 });
    };
    const out = await createProjectHook({
      cfg: { ...cfg, fetchImpl },
      accessToken: "at",
      projectId: 42,
      url: "https://app.example/integrations/gitlab/webhook",
      token: "per-link-secret",
    });
    expect(capturedUrl).toBe(`${cfg.base}/api/v4/projects/42/hooks`);
    expect(capturedBody).toMatchObject({
      url: "https://app.example/integrations/gitlab/webhook",
      token: "per-link-secret",
      issues_events: true,
      note_events: true,
      merge_requests_events: true,
      push_events: false,
    });
    expect(out).toEqual({ id: 555 });
  });

  it("surfaces a permissive failure message when GitLab refuses", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("403 Forbidden", { status: 403 });
    await expect(
      createProjectHook({
        cfg: { ...cfg, fetchImpl },
        accessToken: "at",
        projectId: 1,
        url: "u",
        token: "t",
      }),
    ).rejects.toThrow(/createProjectHook failed: 403/);
  });
});

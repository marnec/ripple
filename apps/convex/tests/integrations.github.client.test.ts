import { describe, expect, it, vi } from "vitest";
import { GithubClient } from "../convex/integrations/github/client";

/**
 * Generate a throwaway RSA key just to satisfy the GithubClient
 * constructor. Tests below never actually mint a token; we focus on the
 * `request` path with a fake fetch.
 */
async function makeClient(fetchImpl: typeof fetch) {
  const keypair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keypair.privateKey);
  let bin = "";
  const bytes = new Uint8Array(pkcs8);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  const pem = `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return new GithubClient({
    appId: "1",
    privateKeyPem: pem,
    apiBase: "https://test.example",
    fetchImpl,
  });
}

describe("integrations/github/client.request", () => {
  it("returns { status, body } for a 200 response", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = await makeClient(fakeFetch as unknown as typeof fetch);

    const res = await client.request({
      installationToken: "ghs_x",
      method: "GET",
      path: "/repos/acme/web/issues/42",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("captures Retry-After (seconds) on a 429 response", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    );
    const client = await makeClient(fakeFetch as unknown as typeof fetch);

    const res = await client.request({
      installationToken: "ghs_x",
      method: "PATCH",
      path: "/repos/acme/web/issues/42",
      body: { state: "closed" },
    });

    expect(res.status).toBe(429);
    expect(res.retryAfterMs).toBe(60_000);
  });

  it("returns status=null on network errors so the outbound classifier marks it 'retry'", async () => {
    const fakeFetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = await makeClient(fakeFetch as unknown as typeof fetch);

    const res = await client.request({
      installationToken: "ghs_x",
      method: "GET",
      path: "/anything",
    });

    expect(res.status).toBeNull();
    expect(res.errorMessage).toContain("fetch failed");
  });
});

describe("integrations/github/client.fetchClosingIssueNodeIds", () => {
  it("parses closingIssuesReferences node ids from a GraphQL response", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                closingIssuesReferences: {
                  nodes: [{ id: "I_one" }, { id: "I_two" }],
                },
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = await makeClient(fakeFetch as unknown as typeof fetch);

    const ids = await client.fetchClosingIssueNodeIds({
      installationToken: "ghs_x",
      owner: "acme",
      repo: "web",
      prNumber: 7,
    });

    expect(ids).toEqual(["I_one", "I_two"]);
    // GraphQL goes to the /graphql endpoint, not REST.
    expect(fakeFetch.mock.calls[0]?.[0]).toContain("/graphql");
  });

  it("returns [] when the PR has no closing references", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: { closingIssuesReferences: { nodes: [] } },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = await makeClient(fakeFetch as unknown as typeof fetch);

    const ids = await client.fetchClosingIssueNodeIds({
      installationToken: "ghs_x",
      owner: "acme",
      repo: "web",
      prNumber: 7,
    });

    expect(ids).toEqual([]);
  });
});

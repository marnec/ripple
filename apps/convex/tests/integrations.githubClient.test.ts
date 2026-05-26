import { describe, expect, it, vi } from "vitest";
import {
  InstallationClient,
  type AuthedGithubApi,
  type GithubResponse,
} from "../convex/integrations/github/client";

/**
 * Unit tests for the installation-scoped auth handle — the seam that replaced
 * the env→construct→mint→thread-token preamble copied across every GitHub
 * action. A fake `AuthedGithubApi` exercises the lazy-mint/cache/thread
 * behaviour without signing a real JWT.
 */

function fakeApi(
  responder: (path: string, token: string) => GithubResponse<unknown> = (
    _p,
    token,
  ) => ({ status: 200, body: { token } }),
) {
  const api: AuthedGithubApi = {
    mintInstallationToken: vi.fn(async (id: string) => `tok-for-${id}`),
    request: vi.fn(async (a) => responder(a.path, a.installationToken) as never),
    fetchBranches: vi.fn(async (a) => [`${a.owner}/${a.repo}@${a.installationToken}`]),
    fetchClosingIssueNodeIds: vi.fn(async (a) => [`pr-${a.prNumber}-${a.installationToken}`]),
  };
  return api;
}

describe("InstallationClient", () => {
  it("threads the minted token into request() so callers don't pass it", async () => {
    const api = fakeApi();
    const inst = new InstallationClient(api, "inst-7");

    const res = await inst.request<{ token: string }>({
      method: "GET",
      path: "/x",
    });

    expect(res.body?.token).toBe("tok-for-inst-7");
    expect(api.request).toHaveBeenCalledWith({
      installationToken: "tok-for-inst-7",
      method: "GET",
      path: "/x",
    });
  });

  it("mints the token once and reuses it across multiple calls", async () => {
    const api = fakeApi();
    const inst = new InstallationClient(api, "inst-1");

    await inst.request({ method: "GET", path: "/a" });
    await inst.fetchBranches({ owner: "acme", repo: "web" });
    await inst.fetchClosingIssueNodeIds({ owner: "acme", repo: "web", prNumber: 9 });

    expect(api.mintInstallationToken).toHaveBeenCalledTimes(1);
    expect(api.mintInstallationToken).toHaveBeenCalledWith("inst-1");
  });

  it("threads the token into fetchBranches and fetchClosingIssueNodeIds", async () => {
    const api = fakeApi();
    const inst = new InstallationClient(api, "inst-2");

    expect(await inst.fetchBranches({ owner: "o", repo: "r" })).toEqual([
      "o/r@tok-for-inst-2",
    ]);
    expect(
      await inst.fetchClosingIssueNodeIds({ owner: "o", repo: "r", prNumber: 4 }),
    ).toEqual(["pr-4-tok-for-inst-2"]);
  });
});

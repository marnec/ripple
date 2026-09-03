import { describe, expect, it } from "vitest";
import { missingIdentityHints } from "./member-identity-hints";

/**
 * The "Not connected to GitHub / GitLab" nudge next to a member in the
 * workspace members list (ticket 03). A hint is shown only when the
 * workspace has an active integration for that provider AND the member has
 * no identity for it; the two providers are independent.
 */
describe("missingIdentityHints", () => {
  const nobody = { githubConnected: false, gitlabConnected: false };

  it("hints for a provider the workspace uses that the member has not connected", () => {
    expect(missingIdentityHints(nobody, ["github"])).toEqual([
      "Not connected to GitHub",
    ]);
  });

  it("stays quiet for a member who has connected", () => {
    expect(
      missingIdentityHints({ githubConnected: true, gitlabConnected: false }, ["github"]),
    ).toEqual([]);
  });

  it("shows nothing for a provider with no active integration, whoever the member is", () => {
    expect(missingIdentityHints(nobody, [])).toEqual([]);
    expect(missingIdentityHints(nobody, ["gitlab"])).toEqual(["Not connected to GitLab"]);
  });

  it("reports both providers independently on the same member", () => {
    expect(missingIdentityHints(nobody, ["github", "gitlab"])).toEqual([
      "Not connected to GitHub",
      "Not connected to GitLab",
    ]);
    expect(
      missingIdentityHints({ githubConnected: false, gitlabConnected: true }, ["gitlab", "github"]),
    ).toEqual(["Not connected to GitHub"]);
  });

  it("ignores providers it has no copy for and duplicate installs of one provider", () => {
    expect(missingIdentityHints(nobody, ["github", "github", "bitbucket"])).toEqual([
      "Not connected to GitHub",
    ]);
  });
});

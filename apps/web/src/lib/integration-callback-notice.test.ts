import { describe, expect, it } from "vitest";
import {
  INTEGRATION_CALLBACK_PARAMS,
  readIntegrationCallbackNotice,
} from "./integration-callback-notice";

/**
 * Both provider callbacks bounce a failed install to `/workspaces` with
 * `?<provider>=error`. Until something reads that flag the user arrives at the
 * workspace list with no idea their install did not complete — the flow just
 * silently didn't happen.
 */
describe("readIntegrationCallbackNotice", () => {
  it("reads a failed GitHub install", () => {
    const notice = readIntegrationCallbackNotice("?github_install=error");
    expect(notice?.variant).toBe("error");
    expect(notice?.title).toMatch(/GitHub/);
  });

  it("reads a failed GitLab connection", () => {
    const notice = readIntegrationCallbackNotice("?gitlab_oauth=error");
    expect(notice?.variant).toBe("error");
    expect(notice?.title).toMatch(/GitLab/);
  });

  it("names the capability toggle — the likeliest cause, and the one the admin can fix", () => {
    const notice = readIntegrationCallbackNotice("?github_install=error");
    expect(notice?.description).toMatch(/capabilit/i);
  });

  it("reads a completed install too, so the success landing is not silent either", () => {
    const notice = readIntegrationCallbackNotice("?github_install=success");
    expect(notice?.variant).toBe("success");
  });

  it("ignores a search string carrying neither flag", () => {
    expect(readIntegrationCallbackNotice("?tab=members")).toBeNull();
    expect(readIntegrationCallbackNotice("")).toBeNull();
  });

  it("ignores a value that is neither success nor error", () => {
    expect(readIntegrationCallbackNotice("?github_install=maybe")).toBeNull();
  });

  it("exposes the params to strip, so a reload does not re-toast", () => {
    expect(INTEGRATION_CALLBACK_PARAMS).toEqual([
      "github_install",
      "gitlab_oauth",
      "github_identity",
      "gitlab_identity",
    ]);
  });

  /**
   * "Connect your account" is a member proving which provider user they are,
   * not an admin binding an account to the workspace. Its flags are distinct
   * so a personal connect never reads as an install, and its copy says
   * "your account" — the capability toggle is irrelevant to it.
   */
  describe("identity connect flags", () => {
    it("reads a connected GitHub account", () => {
      const notice = readIntegrationCallbackNotice("?github_identity=success");
      expect(notice?.variant).toBe("success");
      expect(notice?.title).toBe("GitHub account connected");
    });

    it("reads a connected GitLab account", () => {
      const notice = readIntegrationCallbackNotice("?gitlab_identity=success");
      expect(notice?.variant).toBe("success");
      expect(notice?.title).toBe("GitLab account connected");
    });

    it("reads a failed GitHub connect without blaming the capability", () => {
      const notice = readIntegrationCallbackNotice("?github_identity=error");
      expect(notice?.variant).toBe("error");
      expect(notice?.title).toBe("Couldn't connect your GitHub account");
      expect(notice?.description ?? "").not.toMatch(/capabilit/i);
    });

    it("reads a failed GitLab connect", () => {
      const notice = readIntegrationCallbackNotice("?gitlab_identity=error");
      expect(notice?.title).toBe("Couldn't connect your GitLab account");
    });
  });
});

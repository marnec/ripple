import { describe, expect, it } from "vitest";
import { providerLabel } from "@ripple/shared/integrationProvider";

// The label had seven homes across the task surfaces (four copies of an
// identical `PROVIDER_LABEL` record plus three inline ternaries). These pin the
// one home's behaviour, including the fallback the old copies all relied on.
describe("providerLabel", () => {
  it("names the two providers Ripple integrates with", () => {
    expect(providerLabel("github")).toBe("GitHub");
    expect(providerLabel("gitlab")).toBe("GitLab");
  });

  it("falls back to GitHub for a legacy ref with no provider field", () => {
    expect(providerLabel(undefined)).toBe("GitHub");
  });

  it("falls back to GitHub for an unknown provider string", () => {
    expect(providerLabel("bitbucket")).toBe("GitHub");
  });
});

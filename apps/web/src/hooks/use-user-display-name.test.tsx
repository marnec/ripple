import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUserDisplayName } from "./use-user-display-name";

const { members } = vi.hoisted(() => ({
  members: { current: undefined as unknown[] | undefined },
}));
vi.mock("@/contexts/WorkspaceMembersContext", () => ({
  useWorkspaceMembers: () => members.current,
}));

const render = (userId: string | null | undefined, user: unknown) =>
  renderHook(() =>
    useUserDisplayName(userId, user as { name?: string; email?: string }),
  ).result.current;

describe("useUserDisplayName", () => {
  it("keeps the name the public projection already carries", () => {
    members.current = [{ _id: "u1", name: "Member Name", email: "u1@test" }];
    expect(render("u1", { name: "Bob" })).toBe("Bob");
  });

  it("labels a nameless account with the address from the member list", () => {
    // The regression: `users.get` / `mentionedUsers` withhold `email`, so this
    // chip used to render "Unknown" next to a picker entry reading "u1@test".
    members.current = [{ _id: "u1", email: "u1@test" }];
    expect(render("u1", { name: undefined })).toBe("u1@test");
  });

  it("prefers the member's name over their address", () => {
    members.current = [{ _id: "u1", name: "Late Name", email: "u1@test" }];
    expect(render("u1", null)).toBe("Late Name");
  });

  it("stays Unknown for someone outside the workspace", () => {
    members.current = [{ _id: "u2", email: "u2@test" }];
    expect(render("u1", { name: undefined })).toBe("Unknown");
  });

  it("stays Unknown with no member list loaded (guest on a shared document)", () => {
    members.current = undefined;
    expect(render("u1", { name: undefined })).toBe("Unknown");
  });
});

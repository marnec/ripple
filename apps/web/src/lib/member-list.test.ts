import { describe, expect, it } from "vitest";

import { byRoleThenName, matchesMemberQuery } from "./member-list";

describe("byRoleThenName", () => {
  const sort = (members: { role: "admin" | "member"; name: string }[]) =>
    [...members].sort(byRoleThenName).map((m) => m.name);

  it("puts admins before members regardless of name", () => {
    expect(
      sort([
        { role: "member", name: "Aada Lehtinen" },
        { role: "admin", name: "Zora Okafor" },
      ]),
    ).toEqual(["Zora Okafor", "Aada Lehtinen"]);
  });

  it("orders by name within a role", () => {
    expect(
      sort([
        { role: "member", name: "Théo Marchand" },
        { role: "member", name: "Bram de Vries" },
        { role: "admin", name: "Zora Okafor" },
        { role: "admin", name: "Aada Lehtinen" },
      ]),
    ).toEqual(["Aada Lehtinen", "Zora Okafor", "Bram de Vries", "Théo Marchand"]);
  });
});

describe("matchesMemberQuery", () => {
  const member = { name: "Bram de Vries", email: "bram@kestrel.works" };

  it("matches everything on an empty or whitespace query", () => {
    expect(matchesMemberQuery(member, "")).toBe(true);
    expect(matchesMemberQuery(member, "   ")).toBe(true);
  });

  it("matches name and email case-insensitively", () => {
    expect(matchesMemberQuery(member, "BRAM")).toBe(true);
    expect(matchesMemberQuery(member, "kestrel")).toBe(true);
    expect(matchesMemberQuery(member, "de vries")).toBe(true);
  });

  it("rejects a query that matches neither field", () => {
    expect(matchesMemberQuery(member, "okafor")).toBe(false);
  });

  it("tolerates a member with no email", () => {
    expect(matchesMemberQuery({ name: "Bram de Vries" }, "bram")).toBe(true);
    expect(matchesMemberQuery({ name: "Bram de Vries" }, "@")).toBe(false);
  });
});

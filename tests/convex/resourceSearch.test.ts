import { expect, describe, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../../convex/_generated/dataModel";

type AsUser = Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["asUser"];

// Per-resource-type config so the parametrized cases stay readable.
type ResourceCfg = {
  resourceType: "document" | "diagram" | "spreadsheet";
  searchApi:
    | typeof api.documents.search
    | typeof api.diagrams.search
    | typeof api.spreadsheets.search;
  create: (asUser: AsUser, workspaceId: Id<"workspaces">, name: string) => Promise<string>;
  setTags: (asUser: AsUser, id: string, tags: string[]) => Promise<unknown>;
};

const RESOURCE_CFGS: ResourceCfg[] = [
  {
    resourceType: "document",
    searchApi: api.documents.search,
    create: (asUser, workspaceId, name) =>
      asUser.mutation(api.documents.create, { workspaceId, name }),
    setTags: (asUser, id, tags) =>
      asUser.mutation(api.documents.updateTags, { id: id as Id<"documents">, tags }),
  },
  {
    resourceType: "diagram",
    searchApi: api.diagrams.search,
    create: (asUser, workspaceId, name) =>
      asUser.mutation(api.diagrams.create, { workspaceId, name }),
    setTags: (asUser, id, tags) =>
      asUser.mutation(api.diagrams.updateTags, { id: id as Id<"diagrams">, tags }),
  },
  {
    resourceType: "spreadsheet",
    searchApi: api.spreadsheets.search,
    create: (asUser, workspaceId, name) =>
      asUser.mutation(api.spreadsheets.create, { workspaceId, name }),
    setTags: (asUser, id, tags) =>
      asUser.mutation(api.spreadsheets.updateTags, { id: id as Id<"spreadsheets">, tags }),
  },
];

// Exhaust pagination by threading the cursor until isDone, returning all rows.
async function exhaust<T extends { _id: string }>(
  asUser: AsUser,
  searchApi: ResourceCfg["searchApi"],
  baseArgs: { workspaceId: Id<"workspaces">; tags?: string[]; isFavorite?: boolean; searchText?: string },
  pageSize: number,
): Promise<{ pages: T[][]; all: T[] }> {
  const pages: T[][] = [];
  let cursor: string | null = null;
  let safety = 200;
  while (safety-- > 0) {
    const result = (await asUser.query(searchApi, {
      ...baseArgs,
      paginationOpts: { numItems: pageSize, cursor },
    })) as unknown as { page: T[]; isDone: boolean; continueCursor: string };
    pages.push(result.page);
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  return { pages, all: pages.flat() };
}

// ── Parametrized cases: tag filtering across resource types ──────────

describe.each(RESOURCE_CFGS)(
  "$resourceType.search — tag branch",
  ({ searchApi, create, setTags }) => {
    it("returns dense pages and all matches when filtering by a single tag", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

      // 30 tagged + 20 untagged = 50 total; expect to find all 30.
      for (let i = 0; i < 30; i++) {
        const id = await create(asUser, workspaceId, `tagged-${i}`);
        await setTags(asUser, id, ["design"]);
      }
      for (let i = 0; i < 20; i++) {
        await create(asUser, workspaceId, `untagged-${i}`);
      }

      const { pages, all } = await exhaust<{ _id: string }>(
        asUser,
        searchApi,
        { workspaceId, tags: ["design"] },
        10,
      );

      // 3 dense pages of 10 (no nulls dropped, no missed matches).
      const fullPageCount = pages.filter((p) => p.length === 10).length;
      expect(fullPageCount).toBe(3);
      expect(all).toHaveLength(30);
      expect(new Set(all.map((d) => d._id)).size).toBe(30);
    });

    it("preserves AND semantics when multiple tags are selected", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

      // 10 with both, 10 with only design, 5 with only ops.
      const overlapIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const id = await create(asUser, workspaceId, `both-${i}`);
        await setTags(asUser, id, ["design", "ops"]);
        overlapIds.push(id);
      }
      for (let i = 0; i < 10; i++) {
        const id = await create(asUser, workspaceId, `design-${i}`);
        await setTags(asUser, id, ["design"]);
      }
      for (let i = 0; i < 5; i++) {
        const id = await create(asUser, workspaceId, `ops-${i}`);
        await setTags(asUser, id, ["ops"]);
      }

      const { all } = await exhaust<{ _id: string }>(
        asUser,
        searchApi,
        { workspaceId, tags: ["design", "ops"] },
        50,
      );

      expect(all.map((d) => d._id).sort()).toEqual([...overlapIds].sort());
    });

    it("sorts each page by _creationTime descending", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

      for (let i = 0; i < 5; i++) {
        const id = await create(asUser, workspaceId, `r-${i}`);
        await setTags(asUser, id, ["design"]);
      }

      const result = (await asUser.query(searchApi, {
        workspaceId,
        tags: ["design"],
        paginationOpts: { numItems: 50, cursor: null },
      })) as { page: { _creationTime: number }[]; isDone: boolean; continueCursor: string };

      const times = result.page.map((d) => d._creationTime);
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it("returns an empty page for an unresolved tag name", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      await create(asUser, workspaceId, "any");

      const result = await asUser.query(searchApi, {
        workspaceId,
        tags: ["nonexistent"],
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toEqual([]);
      expect(result.isDone).toBe(true);
    });
  },
);

// ── resourceType isolation: by_workspace_tag_type scopes correctly ───

describe("resourceType isolation", () => {
  it("documents.search with tag does not return diagrams sharing the same tag name", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const docId = await asUser.mutation(api.documents.create, { workspaceId, name: "d" });
    const diaId = await asUser.mutation(api.diagrams.create, { workspaceId, name: "g" });
    await asUser.mutation(api.documents.updateTags, { id: docId, tags: ["shared"] });
    await asUser.mutation(api.diagrams.updateTags, { id: diaId, tags: ["shared"] });

    const result = await asUser.query(api.documents.search, {
      workspaceId,
      tags: ["shared"],
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page.map((d) => d._id)).toEqual([docId]);
  });
});

// ── Search precedence: text search wins over tag filter ──────────────

describe("documents.search — precedence", () => {
  it("uses the search index when searchText is provided, ignoring tags", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const alphaId = await asUser.mutation(api.documents.create, {
      workspaceId,
      name: "alpha report",
    });
    await asUser.mutation(api.documents.updateTags, { id: alphaId, tags: ["other"] });
    const betaId = await asUser.mutation(api.documents.create, {
      workspaceId,
      name: "beta report",
    });
    await asUser.mutation(api.documents.updateTags, { id: betaId, tags: ["design"] });

    // searchText "alpha" + tags ["design"] — search wins, tags are ignored.
    const result = await asUser.query(api.documents.search, {
      workspaceId,
      searchText: "alpha",
      tags: ["design"],
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page.map((d) => d._id)).toEqual([alphaId]);
  });
});

// ── Favorites branch: indexed and dense ──────────────────────────────

describe("documents.search — favorites branch", () => {
  it("isFavorite=true uses the favorites index; pages are dense", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const favIds: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = await asUser.mutation(api.documents.create, {
        workspaceId,
        name: `f-${i}`,
      });
      await asUser.mutation(api.favorites.toggle, {
        workspaceId,
        resourceType: "document",
        resourceId: id,
      });
      favIds.push(id);
    }
    for (let i = 0; i < 8; i++) {
      await asUser.mutation(api.documents.create, { workspaceId, name: `nf-${i}` });
    }

    const { pages, all } = await exhaust<{ _id: string }>(
      asUser,
      api.documents.search,
      { workspaceId, isFavorite: true },
      5,
    );

    const fullPageCount = pages.filter((p) => p.length === 5).length;
    expect(fullPageCount).toBe(2);
    expect(new Set(all.map((d) => d._id))).toEqual(new Set(favIds));
  });

});

// ── Default branch unchanged: no filters → paginated workspace list ──

describe("documents.search — default branch", () => {
  it("returns all workspace documents when no filters are active", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      ids.push(await asUser.mutation(api.documents.create, { workspaceId, name: `d-${i}` }));
    }

    const { all } = await exhaust<{ _id: string }>(
      asUser,
      api.documents.search,
      { workspaceId },
      3,
    );

    expect(new Set(all.map((d) => d._id))).toEqual(new Set(ids));
  });
});

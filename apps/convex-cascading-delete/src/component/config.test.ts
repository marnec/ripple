/*
(1.) Test suite for cascade configuration validation
(2.) Ensures configuration builder catches invalid inputs including missing field property
(3.) Verifies proper error messages for developer guidance and duplicate detection

This test suite validates the defineCascadeRules function's ability to catch
configuration errors at definition time. It tests both valid configurations
that should pass validation and invalid configurations that should throw
descriptive errors. These tests ensure developers receive clear feedback
when misconfiguring cascade rules, improving the developer experience and
preventing runtime errors during deletion operations. Special attention is
given to the field property validation which is critical for index queries.
*/

import { describe, it, expect } from "vitest";
import { defineCascadeRules } from "./config.js";

describe("defineCascadeRules", () => {
  it("should accept valid configuration with all required fields", () => {
    const config = defineCascadeRules({
      users: [
        { to: "posts", via: "by_author", field: "authorId" },
        { to: "comments", via: "by_author", field: "authorId" },
      ],
      posts: [{ to: "comments", via: "by_post", field: "postId" }],
    });

    expect(config).toEqual({
      users: [
        { to: "posts", via: "by_author", field: "authorId" },
        { to: "comments", via: "by_author", field: "authorId" },
      ],
      posts: [{ to: "comments", via: "by_post", field: "postId" }],
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("should accept empty configuration", () => {
    const config = defineCascadeRules({});
    expect(config).toEqual({});
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("should accept table with empty rules array", () => {
    const config = defineCascadeRules({
      users: [],
    });
    expect(config).toEqual({ users: [] });
  });

  it("should throw error for null configuration", () => {
    expect(() => defineCascadeRules(null as any)).toThrow(
      "Cascade configuration must be an object"
    );
  });

  it("should throw error for undefined configuration", () => {
    expect(() => defineCascadeRules(undefined as any)).toThrow(
      "Cascade configuration must be an object"
    );
  });

  it("should throw error when rules is not an array", () => {
    expect(() =>
      defineCascadeRules({
        users: { to: "posts", via: "by_author", field: "authorId" } as any,
      })
    ).toThrow('Cascade rules for table "users" must be an array');
  });

  it("should throw error when rule is missing 'to' property", () => {
    expect(() =>
      defineCascadeRules({
        users: [{ via: "by_author", field: "authorId" } as any],
      })
    ).toThrow(
      'Cascade rule in table "users" must have a \'to\' property (target table name)'
    );
  });

  it("should throw error when rule is missing 'via' property", () => {
    expect(() =>
      defineCascadeRules({
        users: [{ to: "posts", field: "authorId" } as any],
      })
    ).toThrow(
      'Cascade rule in table "users" must have a \'via\' property (index name)'
    );
  });

  it("should throw error when rule is missing 'field' property", () => {
    expect(() =>
      defineCascadeRules({
        users: [{ to: "posts", via: "by_author" } as any],
      })
    ).toThrow(
      'Cascade rule in table "users" must have a \'field\' property (field name for index equality)'
    );
  });

  it("should throw error when 'to' is not a string", () => {
    expect(() =>
      defineCascadeRules({
        users: [{ to: 123, via: "by_author", field: "authorId" } as any],
      })
    ).toThrow(
      'Cascade rule in table "users" must have a \'to\' property (target table name)'
    );
  });

  it("should throw error when 'via' is not a string", () => {
    expect(() =>
      defineCascadeRules({
        users: [{ to: "posts", via: 123, field: "authorId" } as any],
      })
    ).toThrow(
      'Cascade rule in table "users" must have a \'via\' property (index name)'
    );
  });

  it("should throw error when 'field' is not a string", () => {
    expect(() =>
      defineCascadeRules({
        users: [{ to: "posts", via: "by_author", field: 123 } as any],
      })
    ).toThrow(
      'Cascade rule in table "users" must have a \'field\' property (field name for index equality)'
    );
  });

  it("should throw error for duplicate rules", () => {
    expect(() =>
      defineCascadeRules({
        users: [
          { to: "posts", via: "by_author", field: "authorId" },
          { to: "posts", via: "by_author", field: "authorId" },
        ],
      })
    ).toThrow('Duplicate cascade rule in table "users": posts:by_author:authorId');
  });
});

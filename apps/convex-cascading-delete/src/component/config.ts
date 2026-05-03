/*
(1.) Configuration builder for defining cascade delete relationships
(2.) Validates configuration structure including required field property
(3.) Provides developer-friendly API for declaring deletion rules

This module exports the primary configuration function used by applications to
define their cascade delete relationships. The defineCascadeRules function accepts
a configuration object mapping source tables to their cascade rules and performs
comprehensive structural validation including the critical field property that
specifies which field in the index is used for equality matching. This declarative
approach allows developers to specify their entire deletion graph in one place,
making it easy to understand and maintain the cascade behavior across their
application while catching configuration errors early at definition time.
*/

import type { CascadeConfig } from "./types.js";

/**
 * Defines cascade delete rules for an application.
 * 
 * This function validates the structure of the cascade configuration and returns
 * it for use with deleteWithCascade operations. It performs comprehensive validation
 * to ensure the configuration is well-formed, though runtime validation of indexes
 * occurs during actual deletion operations.
 * 
 * @param config - Mapping of source tables to their cascade rules
 * @returns Validated and frozen cascade configuration
 * @throws Error if configuration structure is invalid
 * 
 * @example
 * ```typescript
 * export const cascadeRules = defineCascadeRules({
 *   users: [
 *     { to: "posts", via: "by_author", field: "authorId" },
 *     { to: "comments", via: "by_author", field: "authorId" }
 *   ],
 *   posts: [
 *     { to: "comments", via: "by_post", field: "postId" }
 *   ]
 * });
 * ```
 */
export function defineCascadeRules(config: CascadeConfig): CascadeConfig {
  /*
  (1.) Validate that config is an object and not null or undefined
  (2.) Validate that each table's rules is an array
  (3.) Validate that each rule has required to, via, and field properties
  (4.) Check for duplicate rules to prevent configuration errors
  
  This validation ensures the configuration structure is correct before it's used
  in deletion operations. We check that the config object exists, that each table
  maps to an array of rules, and that each rule contains all required properties
  including the critical field property needed for index equality conditions. This
  catches configuration errors early at definition time rather than during runtime
  deletion operations, providing better developer experience and clearer error
  messages. The configuration is frozen to prevent accidental mutations.
  */
  
  if (!config || typeof config !== "object") {
    throw new Error("Cascade configuration must be an object");
  }

  for (const [sourceTable, rules] of Object.entries(config)) {
    if (!Array.isArray(rules)) {
      throw new Error(
        `Cascade rules for table "${sourceTable}" must be an array`
      );
    }

    const seen = new Set<string>();

    for (const rule of rules) {
      if (!rule.to || typeof rule.to !== "string") {
        throw new Error(
          `Cascade rule in table "${sourceTable}" must have a 'to' property (target table name)`
        );
      }

      if (!rule.via || typeof rule.via !== "string") {
        throw new Error(
          `Cascade rule in table "${sourceTable}" must have a 'via' property (index name)`
        );
      }

      if (!rule.field || typeof rule.field !== "string") {
        throw new Error(
          `Cascade rule in table "${sourceTable}" must have a 'field' property (field name for index equality)`
        );
      }

      const ruleKey = `${rule.to}:${rule.via}:${rule.field}`;
      if (seen.has(ruleKey)) {
        throw new Error(
          `Duplicate cascade rule in table "${sourceTable}": ${ruleKey}`
        );
      }
      seen.add(ruleKey);
    }
  }

  return Object.freeze(config);
}

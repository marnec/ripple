"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { markdownToYjsUpdate } from "./lib/headlessEditor";
import {
  descriptionSnapshotValidator,
  type DescriptionSnapshot,
} from "./lib/importDescriptionSnapshot";

/**
 * Convert one import batch's `description` cells into task description
 * snapshots, before the batch's tasks exist.
 *
 * A task description is a Yjs document whose cold-start source is the blob
 * `tasks.yjsSnapshotId` points at, and markdown → Yjs goes through the JSDOM
 * headless editor, which only runs here in Node. So this stores one blob per
 * row and hands the ids back to `runImport`, which passes them to
 * `createImportedTasks` to be set on insert. The task is never visible
 * without its description, so there is no seed to race against.
 *
 * A row whose markdown fails to convert is logged and left out: the task
 * still imports, just without a description. The caller owns every returned
 * blob from here on, including deleting it if the batch fails.
 */
export const convertDescriptions = internalAction({
  args: {
    jobId: v.id("taskImportJobs"),
    startIndex: v.number(),
    count: v.number(),
  },
  returns: v.array(descriptionSnapshotValidator),
  handler: async (ctx, args) => {
    const rows = await ctx.runQuery(
      internal.taskImports.getRowDescriptions,
      args,
    );

    const out: DescriptionSnapshot[] = [];
    for (const { rowIndex, markdown } of rows) {
      let update: Uint8Array | null;
      try {
        update = await markdownToYjsUpdate(markdown);
      } catch (err) {
        console.error("taskImportDescriptions: conversion failed", {
          jobId: args.jobId,
          rowIndex,
          err,
        });
        continue;
      }
      if (!update) continue; // parsed to zero blocks
      // `update` is a Uint8Array, a valid BlobPart at runtime; the cast
      // bridges Uint8Array<ArrayBufferLike> vs BlobPart.
      const storageId = await ctx.storage.store(
        new Blob([update as BlobPart], { type: "application/octet-stream" }),
      );
      out.push({ rowIndex, storageId });
    }
    return out;
  },
});

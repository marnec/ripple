# Changelog

## 0.2.0

- **Batched mode streams the tree instead of collecting it.** The old
  `deleteWithCascadeBatched` walked the entire deletion tree read-only in the
  calling transaction before batching any writes, so a cascade past Convex's
  per-transaction read limits (4,096 index ranges, 32,000 documents) failed
  before it started. Each transaction now pops the deepest parent off a
  persisted frontier, fetches one page of its dependents, deletes them on the
  spot and pushes the ones with rules of their own. Nothing enumerates the
  whole tree, so there is no size at which it stops working.
- **Parents go before children.** The root row is deleted in the calling
  transaction; dependents drain afterwards. This is also what makes the
  traversal cycle-safe without a visited set.
- **Budgets.** `batchSize` (default 500, was 2,000) is rows deleted per
  transaction; new `maxReadsPerBatch` (default 1,024) caps the index reads the
  cascade issues per transaction, leaving the rest of Convex's 4,096 to
  deleters and triggers.
- **Undeletable rows are skipped and reported** rather than refetched forever;
  more than 256 of them abort the job as `failed`. A deleter that returns
  without deleting is detected the same way.
- **`makeBatchDeleteHandler(internalMutation, cd)`** now takes the configured
  `CascadingDelete` instance — the step needs the rules, not only the deleters.
- **Job status** loses `totalTargetCount` (the total is unknowable up front)
  and gains `pendingCount` and `stepCount`. The `pending` status is gone: a job
  is `processing` from the moment it exists.
- **Soft-delete rules are rejected by batched mode** (`softDeleteField` keeps a
  row in its index, which a streaming traversal would fetch again). Inline mode
  still supports them.
- Dropped the `@convex-dev/workflow` dependency: the step chain is scheduled
  directly, one transaction scheduling the next. Component tables are now
  `cascadeJobs` only (`deletionJobs` and `deletionTargetChunks` are gone).

## 0.0.0

- Initial release.

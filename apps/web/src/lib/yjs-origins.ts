/**
 * Well-known Yjs transaction origins shared across the task-description
 * collaboration code. Used to tell *who* produced a transaction:
 *
 * - `SEED_ORIGIN` tags the one-shot apply of a server-seeded GitHub
 *   description snapshot into the live doc. The edit-detection that flips
 *   `descriptionEdited` must ignore transactions with this origin, so the seed
 *   is never mistaken for a user edit. (`Y.applyUpdate` is already
 *   `transaction.local === false`; this is belt-and-suspenders and documents
 *   intent.)
 */
export const SEED_ORIGIN = Symbol("ripple-task-seed-hydration");

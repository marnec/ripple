# 09 — Client readers move to kind and visibility

**What to build:** The web app stops branching on the old column. Everywhere it
asks "is this a direct message" it reads kind, and everywhere it asks about
privacy it reads visibility. This spans the sidebar, the chat container, the
channel members and details sections, channel settings, the create dialog, and
search results.

Nothing a member sees changes. This ticket exists so that ticket 10 can remove
the old column without the web app going blind.

**Blocked by:** 06 — the fields are returned as of ticket 05, but only the
backfill guarantees they are populated on old rows, and reading an absent kind
would render a direct message as a channel.

**Status:** ready-for-agent

- [x] No web app code branches on the old column.
- [x] The sidebar still separates channels from direct messages correctly.
- [x] Direct message labels still derive from their participants.
- [x] Search results still present channels and direct messages as they do
      today.
- [x] Channel settings and details still gate on privacy correctly, and still
      present a direct message as the unconfigurable thing it is.
- [x] The entire existing test suite passes with no test edited.

## Notes on completion

**Eight sites across seven files**, all now through the shared predicates or the
visibility label map. The predicates were already reachable from the web app —
ticket 04 put them in `@ripple/shared` precisely so the client sweep would make
the same forty decisions the backend did, with the same answers.

**The create dialog's form now speaks the new vocabulary.** Its field holds
`public` / `private` and translates to the mutation's `type` argument at the
call. That is the last translation left, and the contract step deletes both it
and the argument. It also means the label map has exactly one keying —
introducing a second map keyed by `open` / `closed` would have re-created the
problem ticket 03 closed.

**The label map is now barely a map.** Store and UI say the same word; what
remains is capitalisation plus the ordering of the visibility picker. Kept for
the second reason, and because one map is what stops the create dialog and the
browse filter drifting apart again.

**A dead branch went away by construction.** The channel details section carried
a "Direct message" case that was unreachable — the settings page renders it only
when the channel is not a DM. Changing its prop from a channel type to a channel
*visibility* makes that unrepresentable rather than merely unreached: a direct
message has no visibility to pass. Same for the members section.

**Two `type` references remain in the web app, both correct.** The browse
search passes `type` as a *query argument*, which the contract step retires; and
the chat container reads `accessInfo.type`, which is a discriminator on that
query's return shape rather than the channel column.

**Evidence:** 560 web tests, 1657 convex tests, lint 5/5 with 0 errors. No test
edited in this ticket.

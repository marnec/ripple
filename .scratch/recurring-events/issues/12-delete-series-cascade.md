# 12 — Delete a series, and cascade it

**What to build:** A cancelled ritual leaves nothing behind. Deleting a series
removes it and everything filed under it — its overrides, its invitee rows, its
guest shares, its graph node and edges, its tags, its call sessions' link to it —
and past occurrences go with it. Nothing of record is lost: transcripts are
documents and the trail is in the audit log, and both already outlive an event.

Deleting the workspace takes its series along with everything else, so no
orphaned rows survive.

**Blocked by:** 04, 08, 10.

**Status:** done

- [x] Deleting a series removes every occurrence from every calendar view.
- [x] Its overrides, invitee rows, guest shares, node, edges, and tag rows are
      all gone, verified individually. (The node/edge/tag rules are written
      against the polymorphic string ids — `resourceId` / `sourceId` /
      `targetId` — so they are complete before issue 07 writes the series'
      node as well as after; the test asserting nothing in the graph survives
      the series holds vacuously until then, and becomes the guard the moment
      it lands.)
- [x] Guest links to the deleted series stop working and degrade to the standard
      not-found treatment rather than an error.
- [x] Transcript documents produced by its calls survive, and their link to the
      deleted session is cleared rather than dangling.
- [x] Deleting the workspace cascades to its series.
- [x] The cascade stays within the existing collection bounds and does not
      regress the known ceiling for very large cascades.

Not in this issue: the outbound `METHOD:CANCEL` mail to guests, which is
issue 09. `eventSeries.cancel` deletes and logs; it sends nothing.

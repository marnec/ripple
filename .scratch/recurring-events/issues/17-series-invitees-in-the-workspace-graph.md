# 17 — Series invitees in the workspace graph

**What to build:** Being invited to a recurring meeting should mean the same
thing in the workspace graph as being invited to a one-off one does. Today it
means nothing: the trigger that turns an invitee into an `invites` edge acts on
the one-off event's roster table only, so a series roster produces no edge at
all and the graph shows a standup nobody is connected to.

This was deferred rather than decided — the roster landed before the series had
a graph node to point at, and the node arrived afterwards without anyone
returning to the edge. The series node, its venue edge and its tags all exist
now, so the gap is simply an unwritten trigger.

One edge per person per series, matching the one-off event's shape: created
when they are invited, removed when they are removed, and gone with the series
when it is deleted.

**Blocked by:** 14.

**Status:** done

- [x] Inviting someone to a series creates the same kind of graph edge that
      inviting them to a one-off event does.
- [x] Removing them removes the edge.
- [x] Deleting the series leaves no edge behind, in either direction.
- [x] An external guest produces no user edge, exactly as on a one-off event.
- [x] Overrides still produce no node and no edge of their own — the exclusions
      that already guard this must stay green.
- [x] The graph holds one node per series and one edge per invitee, with no
      duplicates when someone is invited, removed and invited again.

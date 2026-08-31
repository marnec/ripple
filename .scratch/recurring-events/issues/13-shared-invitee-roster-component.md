# 13 — Prefactor: one roster component for events and series

**What to build:** Nothing changes for anyone using the app. The invitee list
and the invite adder — today a private section wired to the one-off event's
detail shape and to that page's handler types — become one component that takes
a plain roster and callbacks, so a second kind of resource can render the same
thing without a copy.

This is a prefactor and it earns its place: the series roster is stored in its
own table with its own row shape, so without this the next ticket has to choose
between duplicating the list and refactoring it mid-feature. The two row shapes
already agree on everything the UI reads — who it is, whether they are a member
or a guest, what they answered — so the shared shape is a description of what is
there rather than an invention.

The organizer's self-invite ghost row becomes an optional slot rather than a
built-in, because only the one-off event offers it today.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] The one-off event page and the event sheet render the same roster,
      adder, member/guest rows, counts and empty state they render today.
- [x] Adding members, adding guests by email, and removing an invitee behave
      exactly as before from both surfaces.
- [x] The organizer's self-invite ghost row still appears on a one-off event
      when the organizer has not invited themselves, and still disappears once
      they have.
- [x] The component takes a roster and callbacks rather than a query result, so
      a caller backed by a different table needs no change to it.
- [x] No Convex function is added or changed.

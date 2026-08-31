# 09 — Guest mail: recurring ICS in both directions

**What to build:** A guest receives one invitation email describing the whole
repeating pattern, which their mail client understands natively and files as a
single recurring entry — rather than one message per occurrence. An occurrence
that has been moved shows at its new time in their client, so nobody attends an
empty room.

Outbound, that is one calendar entry carrying the rule and the exclusions, plus
one entry per override identified by its original start, under a single
series-level sequence counter bumped on any change that mails guests. A split
sends the truncated original as an update and the new series as a fresh
invitation under a new identifier — never a cancellation, because that makes
clients delete history the organizer did not ask to lose.

Inbound, an RSVP reply that names a single occurrence has that coordinate
**dropped** and the response applied to the series. The asymmetry with the
outbound path is deliberate — outbound correctness is free, inbound correctness
needs the per-occurrence invitee coordinate this release defers — and it should
be commented at both sites so the next reader does not "fix" it.

**Blocked by:** 04, 06, 08.

**Status:** done

- [x] A guest invited to a series receives exactly one invitation carrying the
      rule and any exclusions.
- [x] A moved occurrence reaches the guest as an entry for that original start,
      and their client shows it at the new time.
- [x] A cancelled occurrence disappears from the guest's client.
- [x] The sequence counter lives on the series and is bumped once per
      guest-facing change; override rows leave their own sequence unwritten.
- [x] A split sends an update for the truncated original and a fresh invitation
      for the new series, and sends no cancellation.
- [x] Cancelling the series withdraws it from the guest's client.
- [x] An inbound reply naming one occurrence is applied to the series, with the
      existing replay and idempotency guards intact.
- [x] Both sides of the asymmetry carry a comment explaining it.

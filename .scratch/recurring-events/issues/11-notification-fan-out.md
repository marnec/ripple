# 11 — Notification fan-out per edit scope

**What to build:** The "notify invitees?" prompt tells the organizer what will
actually be sent — how many people, and how many occurrences — so the copy reads
"2 invitees, this occurrence" rather than the same sentence whether one Tuesday
or forty-seven meetings are moving.

And it stays silent when nobody's plans are changing: the existing suppression
for shuffling a past event to another past time generalises to "every affected
occurrence is already in the past", so an organizer tidying up last quarter's
standups does not mail the team. Tag-only changes never notify.

**Blocked by:** 06, 08.

**Status:** done

- [x] The prompt names the invitee count and the affected-occurrence count, and
      the counts are correct for each of the three edit scopes.
- [x] A change affecting only past occurrences sends nothing, for every scope.
- [x] A change affecting any future occurrence prompts, and sends when confirmed.
- [x] A tag-only change never prompts and never sends.
- [x] Declining the prompt applies the change and sends nothing.
- [x] The suppression rule is shared between the client prompt and the server
      safety net rather than duplicated.

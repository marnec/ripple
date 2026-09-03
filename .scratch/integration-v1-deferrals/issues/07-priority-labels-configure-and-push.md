# 07 — Priority label map: configure and push

**What to build:** On a repo link's card in project settings, an admin can
set four label names, one per Ripple priority (urgent, high, medium, low),
with a "Fill from pattern" shortcut that expands something like
`priority/{priority}` into the four fields before saving. Once set, changing
a linked task's priority swaps the matching label on the provider issue, and
creating an issue from a task sends the priority label along with the tags.
A link without a map behaves exactly as today.

Priority labels are a separate vocabulary from tags: they are added to the
outbound label set at push time and never written into the task's tags. The
task link's mirror of the provider's label set keeps holding the full set
(tags plus priority label) so the existing echo guard and diff keep working
unchanged. The map is validated: non-empty after normalization, four
distinct values, and none colliding with a tag used as a repo-routing key on
the same project.

Spec: `plans/integration-v1-deferrals.md`, plan C.

**Blocked by:** 06 — Prefactor: labels travel with issue creation in both
directions.

**Status:** done

- [x] An admin saves a four-entry map on a link; a non-admin cannot. All-empty
      clears the map.
- [x] Validation rejects an empty slot, duplicate values, and a value that is
      also a repo-routing tag on the project.
- [x] "Fill from pattern" populates the four inputs from a `{priority}`
      placeholder without saving.
- [x] Changing priority urgent→low on a linked task enqueues one labels push
      that adds the low label and removes the urgent label, on both
      providers.
- [x] A tag edit on the same task pushes the tag change and leaves the
      priority label in place.
- [x] Creating an issue from a task includes its priority label in the create
      call; the link row mirrors the sent set.
- [x] The task's tags never contain the priority label after any of the
      above.
- [x] Links without a map: priority changes enqueue nothing, and every
      existing labels test passes unchanged.

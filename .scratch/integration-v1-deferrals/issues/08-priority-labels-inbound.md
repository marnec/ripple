# 08 — Priority label map: inbound

**What to build:** With a priority map configured on a link, labeling an
issue on the provider drives the task's priority in Ripple. Adding `P1` on a
link mapping high→`p1` makes the task high priority and logs a priority
change attributed to the integration bot. The priority label is stripped
before the task's tags are updated, so it never shows up as a tag. Issues
that are opened or imported with a priority label land at that priority
instead of the current hard-coded medium. When several priority labels are
present the highest wins. Removing the priority label upstream leaves the
task's priority untouched: the absence of a label is not treated as a
statement.

Spec: `plans/integration-v1-deferrals.md`, plan C.

**Blocked by:** 07 — Priority label map: configure and push.

**Status:** done

- [x] A labels-changed event carrying a mapped label sets the task's
      priority and logs a bot-attributed priority change; the label does not
      appear among the task's tags or join rows.
- [x] An opened or imported issue with a mapped label creates the task at
      that priority; without one it stays medium.
- [x] Several mapped labels at once resolve to the highest priority.
- [x] Removing the mapped label upstream changes tags only; priority stays.
- [x] The echo guard still suppresses the bounce-back of Ripple's own
      priority push from ticket 07 (no second activity entry).
- [x] Links without a map: inbound label events behave exactly as today.

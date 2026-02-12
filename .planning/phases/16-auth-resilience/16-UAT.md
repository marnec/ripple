---
status: complete
phase: 16-auth-resilience
source: 16-01-SUMMARY.md, 16-02-SUMMARY.md
started: 2026-02-12T23:30:00Z
updated: 2026-02-12T23:45:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Collaboration Reconnects After Network Drop
expected: Open a collaborative document. Briefly disconnect your network (toggle WiFi off/on or unplug ethernet). After reconnecting, the editor should automatically resume collaboration without requiring a page reload. The connection status indicator should show offline briefly, then return to connected.
result: issue
reported: "in local development I used the chrome dev tools to set my network as offline but the network indicator in the document remains green"
severity: major

### 2. Extended Editing Session Stays Connected
expected: Open a collaborative document and keep editing for several minutes. The connection should remain stable without dropping due to token expiration. No page reload should be needed to continue collaborating.
result: pass

### 3. Diagram Embeds Show Placeholder
expected: Open a task description or document that has an embedded diagram. The embedded diagram should show a "Click to view diagram" placeholder (not a broken/empty state). Clicking it should navigate to the diagram.
result: issue
reported: "clicking does not navigate to diagram, also we never discussed the fact that embedding preview was being removed. You should have brought this up"
severity: major

### 4. Revoked User Gets Disconnected
expected: Have two users open the same document. Remove one user's workspace or project membership from the admin UI. Within about 60 seconds, the removed user's collaboration should disconnect and they should see an indication that access was revoked (not just an abrupt connection drop).
result: skipped
reason: Convex real-time subscriptions cause immediate re-render and uncaught error on user removal, navigating away before 30s PartyKit check fires. Expected behavior until error boundaries are in place.

### 5. No Reconnection Loop After Revocation
expected: After a user's permission is revoked and they're disconnected (Test 4), the client should NOT attempt to reconnect in an infinite loop. The editor should stay in a disconnected/read-only state without spamming reconnection attempts.
result: skipped
reason: Cannot test for same reason as Test 4 - Convex subscription reacts before PartyKit permission check.

## Summary

total: 5
passed: 1
issues: 2
pending: 0
skipped: 2

## Gaps

- truth: "Connection status indicator reflects actual network state"
  status: failed
  reason: "User reported: in local development I used the chrome dev tools to set my network as offline but the network indicator in the document remains green"
  severity: major
  test: 1
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- truth: "Diagram embeds are clickable and navigate to the diagram; preview removal was discussed with user"
  status: failed
  reason: "User reported: clicking does not navigate to diagram, also we never discussed the fact that embedding preview was being removed. You should have brought this up"
  severity: major
  test: 3
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

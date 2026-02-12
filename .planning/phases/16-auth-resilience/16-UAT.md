---
status: complete
phase: 16-auth-resilience
source: 16-03-SUMMARY.md, 16-04-SUMMARY.md
started: 2026-02-12T23:55:00Z
updated: 2026-02-12T23:55:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Connection Indicator Responds to Browser Offline
expected: Open a collaborative document. Use Chrome DevTools (Network tab) to set throttling to "Offline". The connection status indicator should turn to offline/disconnected state immediately (not stay green). When you switch back to "No throttling", the indicator should eventually return to connected state.
result: issue
reported: "on setting throttling to offline the connection status indicator turned immediately to offline but upon removing throttling it never came back online"
severity: major

### 2. Diagram Block Click Navigates to Diagram
expected: Open a document that has an embedded diagram block. Click on the diagram placeholder/preview. It should navigate you to the full diagram page at /workspaces/{id}/diagrams/{id}.
result: pass

### 3. SVG Preview Generated for Diagrams
expected: Open a diagram and draw a few shapes (rectangles, arrows, etc). Wait about 10-15 seconds. The diagram's SVG preview should be silently saved to Convex in the background (you can verify by then embedding this diagram elsewhere and seeing a preview instead of just a placeholder).
result: pass

### 4. SVG Preview Renders in Document Embeds
expected: Open a document and embed a diagram that has been opened and edited (so it has an SVG preview). The embedded diagram should show an actual visual SVG preview of the diagram content — not just a text placeholder saying "Click to view."
result: pass

### 5. SVG Preview Renders in Task Embeds
expected: Open a task description and embed a diagram that has an SVG preview. The embedded diagram should show an inline SVG preview of the diagram content with a max height constraint, not just a text placeholder.
result: pass

## Summary

total: 5
passed: 4
issues: 1
pending: 0
skipped: 0

## Gaps

- truth: "Connection status indicator recovers to connected state when network comes back online"
  status: failed
  reason: "User reported: on setting throttling to offline the connection status indicator turned immediately to offline but upon removing throttling it never came back online"
  severity: major
  test: 1
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

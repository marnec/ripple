# Requirements: Ripple v0.9 Chat Features

**Defined:** 2026-02-07
**Core Value:** Seamless integration between all workspace features — users, documents, diagrams, and tasks can reference and embed each other, creating a connected workspace rather than isolated tools.

## v0.9 Requirements

### @User Mentions

- [ ] **MENT-01**: User can type @ in chat to trigger autocomplete dropdown of workspace members
- [ ] **MENT-02**: User can select a member from autocomplete to insert a styled @mention chip
- [ ] **MENT-03**: @mention chips render with user name in both composer and message display
- [ ] **MENT-04**: Mentioned users receive push notification ("Alice mentioned you in #general")
- [ ] **MENT-05**: Self-mentions are filtered from notifications (mentioning yourself doesn't notify you)

### Emoji Reactions

- [ ] **REACT-01**: User can open emoji picker on any message to select a reaction
- [ ] **REACT-02**: Reactions display as Slack-style pills below message with emoji and count
- [ ] **REACT-03**: User can click an existing reaction pill to toggle their reaction on/off
- [ ] **REACT-04**: Hovering a reaction pill shows tooltip listing users who reacted
- [ ] **REACT-05**: Multiple different emoji reactions supported per message
- [ ] **REACT-06**: Reactions update in real-time across all connected clients

### Inline Reply-To

- [ ] **REPLY-01**: User can click "Reply" on a message to enter reply mode in composer
- [ ] **REPLY-02**: Reply mode shows quoted preview of original message in composer (with cancel button)
- [ ] **REPLY-03**: Submitted reply displays in chat flow with compact quoted preview above it
- [ ] **REPLY-04**: If original message is deleted, reply shows "Message deleted" placeholder gracefully

## Future Requirements

### v1.0+

- **MENT-06**: @channel / @here mentions with admin controls
- **MENT-07**: Smart autocomplete prioritizing recent conversation participants
- **MENT-08**: Mention notification bundling ("3 new mentions in #design")
- **REACT-07**: Emoji skin tone variant picker
- **REACT-08**: Emoji quick-pick bar on message hover (3-5 common reactions)
- **REPLY-05**: Click quote preview to jump to and highlight original message
- **REPLY-06**: Rich quote previews preserving task mentions and project chips

## Out of Scope

| Feature | Reason |
|---------|--------|
| Threaded replies (Slack-style) | Explicitly chose inline reply model — simpler, matches modern chat direction (Google Chat deprecated threading in 2023) |
| Custom workspace emoji | Significant upload/storage complexity; wait for user demand |
| Reaction notifications | Reactions are lightweight acknowledgments, not worth interrupting users |
| Nested reply depth | Inline model avoids nesting entirely — no reply-to-reply chains |
| @everyone without restrictions | Abuse risk in large channels; defer until admin controls exist |
| Auto-emoji from text (:smile:) | Cognitive overhead; emoji picker search is better UX |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MENT-01 | Pending | Pending |
| MENT-02 | Pending | Pending |
| MENT-03 | Pending | Pending |
| MENT-04 | Pending | Pending |
| MENT-05 | Pending | Pending |
| REACT-01 | Pending | Pending |
| REACT-02 | Pending | Pending |
| REACT-03 | Pending | Pending |
| REACT-04 | Pending | Pending |
| REACT-05 | Pending | Pending |
| REACT-06 | Pending | Pending |
| REPLY-01 | Pending | Pending |
| REPLY-02 | Pending | Pending |
| REPLY-03 | Pending | Pending |
| REPLY-04 | Pending | Pending |

**Coverage:**
- v0.9 requirements: 15 total
- Mapped to phases: 0
- Unmapped: 15 ⚠️

---
*Requirements defined: 2026-02-07*
*Last updated: 2026-02-07 after initial definition*

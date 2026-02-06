# Feature Research: Chat Enhancements

**Domain:** Real-time collaborative chat messaging (Slack/Teams/Discord-style)
**Researched:** 2026-02-07
**Confidence:** HIGH

## Executive Summary

This research examines the expected behavior and implementation patterns for three chat features being added to Ripple v0.9: @user mentions, emoji reactions, and inline reply-to. The findings are based on established patterns from Slack, Microsoft Teams, Discord, and other modern chat platforms.

**Key insight:** These features are table stakes for professional collaboration tools in 2026. Users expect specific behaviors based on years of conditioning from Slack and Teams. The implementation must nail the fundamentals or users will perceive the product as incomplete.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **@mentions - Autocomplete on typing @** | Universal pattern from all chat apps; users type @ and expect dropdown | MEDIUM | Must support keyboard navigation (up/down arrows, Enter) and mouse selection. Filter as they type. |
| **@mentions - Styled chips in message** | Visual differentiation from plain text; users need to see who's mentioned at a glance | LOW | Existing UserBlock pattern from task descriptions can be reused. Rounded pill with avatar + name. |
| **@mentions - Push notification to mentioned user** | Core value prop of @mentions; notification is why you mention someone | MEDIUM | Ripple already has push notifications infrastructure from v0.8. Need new trigger in message.send mutation. |
| **@mentions - Works in message edits** | Users expect to add mentions when editing messages | MEDIUM | Diff-based detection (already implemented for task comments) prevents duplicate notifications. |
| **@mentions - @channel / @here variants** | Professional tools expect mass-mention options; Slack has @channel (all members) and @here (active only) | MEDIUM | Optional for v1 but users will ask for it. Requires admin controls to prevent abuse in large channels. |
| **Reactions - Click to add/remove** | One-click interaction; clicking your own reaction removes it (toggle behavior) | LOW | Standard pattern. Must highlight user's own reactions differently (e.g., darker background). |
| **Reactions - Aggregated counter display** | Users expect to see how many people reacted with same emoji (e.g., 👍 3) | LOW | Group by emoji, count unique users. Display as pills below message. |
| **Reactions - "Who reacted" tooltip** | Hovering reaction pill shows list of users who reacted | LOW | Enhances transparency. Common in Slack, Teams, Discord. |
| **Reactions - Emoji picker** | Users can't type Unicode; need visual picker to browse and select emojis | MEDIUM | Skin tone variants add complexity but are expected (press-and-hold or right-click for variants). Many React libraries available. |
| **Reactions - Multiple reactions per message** | Users expect to react with different emojis to same message (not just one) | LOW | No artificial limits. Slack allows unlimited reactions. |
| **Reply-to - Quote preview in message** | Visual link to original message; users need context for what's being replied to | MEDIUM | Display truncated original message above reply (max 2-3 lines). Click preview to jump to original. |
| **Reply-to - Jump to original message** | Clicking quote preview scrolls to and highlights original message | MEDIUM | Requires scroll-to logic and temporary highlight (e.g., yellow flash). |
| **Reply-to - Handle deleted original** | Original message may be deleted after reply is sent | LOW | Display "[Message deleted]" placeholder in quote. WhatsApp 2025 update removes quote when original deleted for privacy. |
| **Reply-to - Visual connector/thread line** | Subtle visual indicator linking reply to original (vertical line, indentation, icon) | LOW | Helps users scan and understand reply relationships at a glance. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Cross-feature mention integration** | @mention a user in chat AND in task descriptions/comments with unified notification preferences | LOW | Ripple already has @mentions in task comments. Unifying the experience (same chip design, same notification settings) creates cohesion that Teams/Slack lack. |
| **Mention + Reply combined** | Reply to a message while @mentioning someone else to bring them into the conversation | LOW | Natural integration — reply-to provides context, mention provides targeting. Most chat apps support this but don't highlight it. |
| **Reaction on reply-to message** | Users can react to a reply just like any message; no artificial limitations | LOW | Some chat apps treat replies as second-class. Treating them equally feels powerful. |
| **Search includes mentioned messages** | Filter search results to "messages where I was mentioned" | MEDIUM | Leverages existing full-text search. Requires mentionedUserIds field on messages table. Powerful for catching up after time away. |
| **Mention notification bundling** | If mentioned multiple times in short window, bundle into single notification: "3 new mentions in #design" | MEDIUM | Reduces notification fatigue. Slack does this poorly; opportunity to improve. Requires batching logic in push notification scheduler. |
| **Smart mention suggestions** | Autocomplete prioritizes recent conversation participants, assignees of linked tasks | MEDIUM | Better than alphabetical. Context-aware. Requires logic to track recent participants + linked task assignees. |
| **Emoji reaction quick-pick** | Hover over message shows 3-5 most common reactions for one-click add (👍 ❤️ 😄 🎉 👀) | MEDIUM | Slack has this; reduces friction vs opening full picker. Customize per workspace or use defaults. |
| **Reply-to preserves rich content** | Quote preview shows task mentions, project chips, not just plain text | HIGH | Leverage BlockNote's existing rich content rendering. Most chat apps strip to plain text in quote. |

### Anti-Features (Commonly Requested, Often Problematic)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| **Threaded replies (nested conversations)** | Users from Slack expect threads; seems organized | Creates split attention — main channel vs thread. Messages get lost. Google Chat abandoned two threading models for inline-only in 2023. | **Inline reply-to** (already chosen): Replies stay in main flow with quote preview. Better for keeping everyone in sync. |
| **Limited reaction set** | Easier to implement; less UI complexity | Feels restrictive. Users want expressiveness. Teams tried this, users complained. | **Full emoji picker** (already chosen): Modern chat apps (Slack, Discord) allow any emoji. Use well-designed picker (emoji-picker-react). |
| **Reaction removal by others** | Moderation feature; remove inappropriate reactions | Opens abuse vector — deleting others' reactions creates conflict. | Only user who reacted can remove their own reaction. Message author can delete entire message (which removes all reactions). |
| **Nested reply depth limits** | Prevent infinite nesting | With inline replies, not needed — no nesting, just quote references. | N/A — inline model avoids this problem entirely. |
| **Disable mentions per user** | Privacy concern — don't want to be @mentioned | Breaks core collaboration feature. If you don't want mentions, leave channel. | Notification preferences — mute specific channels, but mentions still work for those who need to find you. |
| **Auto-emoji from text** | Slack converts :smile: to 😄 automatically | Cognitive overhead — users forget syntax, typos create confusion. Modern emoji pickers with search ("smile" → 😄) are better UX. | Emoji picker with search. Reserve : syntax for deliberate emoji codes if users want it. |
| **Mention everyone with no restrictions** | "I should be able to notify everyone in my workspace" | Abuse in large channels. Slack requires confirmation for @channel when 6+ members. Teams requires admin permission. | Workspace admins can configure who can use @channel/@here. Require confirmation dialog for channels with 10+ members. |
| **Reactions count as unread** | "I want to know someone reacted to my message" | Notification fatigue. Reactions are lightweight, not worth interrupting. | Reactions visible on message; don't increment unread count. Optionally: notification only for first reaction on your message. |

## Feature Dependencies

### Dependency Graph

```
Chat message infrastructure (existing) ✓
├── @user mentions
│   ├── Autocomplete component
│   │   └── Keyboard navigation
│   ├── UserMention inline content (reuse from tasks) ✓
│   ├── mentionedUserIds field on messages
│   └── Push notification trigger (modify existing) ✓
│
├── Emoji reactions
│   ├── reactions table (new)
│   │   ├── messageId (foreign key)
│   │   ├── userId (foreign key)
│   │   └── emoji (string)
│   ├── Emoji picker component
│   │   ├── Skin tone variants
│   │   └── Search/categories
│   ├── Reaction aggregation query
│   └── Reaction toggle mutation (add/remove)
│
└── Inline reply-to
    ├── replyToMessageId field on messages
    ├── Quote preview component
    │   ├── Render rich content (BlockNote) ✓
    │   └── Truncation logic
    ├── Jump-to-message scroll logic
    └── Deleted message handling
```

### Cross-Feature Interactions

| Scenario | Expected Behavior | Implementation Notes |
|----------|-------------------|---------------------|
| **React to a reply** | Works normally — reactions apply to reply message, not original | No special handling. Reply is a message like any other. |
| **Mention in a reply** | Quote shows original, mention notifies user, both work independently | Quote is structural (replyToMessageId). Mentions are content (mentionedUserIds). Orthogonal features. |
| **Reply to message with reactions** | Reactions stay on original; reply has separate reaction set | Each message has its own reactions. No inheritance. |
| **Delete original message that has replies** | Replies persist; quote preview shows "[Message deleted]" | Similar to how Slack handles it. Don't cascade delete. |
| **Edit message to add mention** | Diff-based detection (existing pattern from task comments) prevents duplicate notifications for existing mentions, sends for new mentions | Reuse diff algorithm from task mutation. |
| **Search for mentioned messages** | Full-text search can filter by mentionedUserIds field | Extend existing search query with optional userId filter. |
| **Notification for mention in reply** | Mentioned user gets notification even if they weren't in original conversation | Mentions are explicit; don't suppress notifications based on reply context. |
| **Reaction emoji is same as mentioned user's avatar** | No conflict — reactions and mentions are separate UI elements | Unlikely edge case; no special handling needed. |

## MVP Definition

### Launch With (v0.9)

**Must have for launch:**
1. **@mentions - Core flow**
   - Type @ to trigger autocomplete dropdown
   - Autocomplete filters workspace members by name
   - Keyboard navigation (up/down, Enter to select, Esc to close)
   - Insert UserMention inline content (reuse existing UserBlock from tasks)
   - Save mentionedUserIds on message
   - Push notification to mentioned users

2. **Emoji reactions - Core flow**
   - Click emoji button on message hover → opens emoji picker
   - Click emoji in picker → adds reaction to message
   - Click existing reaction pill → toggles reaction on/off
   - Display reaction pills below message with counter (👍 3)
   - Hover reaction pill → tooltip shows who reacted

3. **Inline reply-to - Core flow**
   - Click reply button on message → activates reply mode in composer
   - Quote preview shows in composer (original message truncated to 2 lines)
   - Submit reply → saves replyToMessageId, displays quote preview above reply in chat
   - Click quote preview → jumps to original message with highlight

**Can defer:**
- @channel / @here mentions (high value but adds admin controls complexity)
- Emoji skin tone variants (use default skin tone only for v1)
- Emoji quick-pick hover (show picker only, skip shortcuts)
- Smart mention suggestions (use alphabetical for v1)
- Mention notification bundling (send individual notifications)
- Search filter by mentions (basic search works)

### Add After Validation (v1.1)

**After users validate core features:**
1. @channel / @here mentions with admin controls
2. Emoji skin tone variant picker
3. Emoji quick-pick on hover (👍 ❤️ 😄 shortcut bar)
4. Search filter: "messages where I was mentioned"
5. Smart autocomplete: prioritize recent participants, assignees

### Future Consideration (v2+)

**Strategic features, not urgent:**
1. Mention notification bundling ("3 new mentions in #design")
2. Custom emoji upload (Slack-style workspace-specific emojis)
3. Reaction notifications (optional: notify when first person reacts to your message)
4. Animated emoji reactions (Google Meet-style floating emojis)
5. @mention suggestions in reply context (automatically suggest original message author)
6. Rich quote previews with embedded diagrams/tasks

## Feature Prioritization Matrix

| Feature | User Value | Engineering Effort | Risk | Priority | Launch |
|---------|------------|-------------------|------|----------|--------|
| @mentions autocomplete | Critical | Medium | Low | P0 | v0.9 |
| @mentions push notifications | Critical | Low | Low | P0 | v0.9 |
| Emoji reaction add/remove | Critical | Medium | Low | P0 | v0.9 |
| Emoji picker | Critical | Medium | Low | P0 | v0.9 |
| Reply-to with quote preview | Critical | Medium | Medium | P0 | v0.9 |
| Jump to original message | High | Medium | Low | P0 | v0.9 |
| Who reacted tooltip | High | Low | Low | P0 | v0.9 |
| @channel / @here | High | Medium | Medium | P1 | v1.1 |
| Emoji skin tones | Medium | Low | Low | P1 | v1.1 |
| Smart autocomplete | Medium | Medium | Low | P1 | v1.1 |
| Search by mentions | Medium | Low | Low | P1 | v1.1 |
| Emoji quick-pick | Medium | Medium | Low | P2 | v1.1 |
| Mention bundling | Low | High | Medium | P2 | v2+ |
| Custom emoji upload | Low | High | Medium | P3 | v2+ |

### Prioritization Rationale

**P0 (v0.9):** Table stakes features. Without these, the feature set feels incomplete and users will compare unfavorably to Slack.

**P1 (v1.1):** Differentiators and quality-of-life improvements. Validate core features first, then add these to polish the experience.

**P2-P3 (v2+):** Nice-to-have features that require disproportionate engineering effort or introduce complexity. Wait for user requests.

## Competitor Feature Analysis

| Feature | Slack | Microsoft Teams | Discord | WhatsApp | Google Chat | Ripple v0.9 Target |
|---------|-------|-----------------|---------|----------|-------------|-------------------|
| **@user mentions** | ✓ Full | ✓ Full | ✓ Full | ✓ Full | ✓ Full | ✓ Full |
| **Mention autocomplete** | ✓ Smart (recent) | ✓ Basic (alpha) | ✓ Basic (alpha) | ✓ Basic | ✓ Basic | ✓ Basic (smart in v1.1) |
| **@channel / @here** | ✓ Both | ✓ @channel only | ✓ @everyone | ✗ | ✓ @all | Defer to v1.1 |
| **Mention notifications** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Emoji reactions** | ✓ Unlimited | ✓ Limited set | ✓ Unlimited | ✓ 6 predefined | ✓ Unlimited | ✓ Unlimited |
| **Emoji picker** | ✓ Full | ✓ Full | ✓ Full | ✗ | ✓ Full | ✓ Full |
| **Skin tone variants** | ✓ | ✓ | ✓ | ✓ | ✓ | Defer to v1.1 |
| **Reaction counter** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Who reacted tooltip** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Emoji quick-pick** | ✓ (3 emojis) | ✗ | ✗ | ✗ | ✗ | Defer to v1.1 |
| **Reply-to inline** | ✗ (threads) | ✗ (threads) | ✗ (threads) | ✓ | ✓ (switched 2023) | ✓ |
| **Reply-to threaded** | ✓ | ✓ | ✓ | ✗ | ✗ (deprecated) | ✗ (by design) |
| **Quote preview** | N/A | N/A | N/A | ✓ | ✓ | ✓ |
| **Jump to original** | ✓ (in thread) | ✓ (in thread) | ✓ (in thread) | ✓ | ✓ | ✓ |
| **Custom emoji** | ✓ | ✗ | ✓ | ✗ | ✗ | v2+ |

### Key Takeaways

1. **Mentions are universal** — Every platform has @user mentions with autocomplete. This is non-negotiable table stakes.

2. **Reactions split: unlimited vs limited** — Slack and Discord allow any emoji. Teams restricts to predefined set (changed in 2024 to expand to 800+ but still curated). Users prefer unlimited. Ripple should match Slack.

3. **Reply models diverging** — Traditional platforms (Slack, Teams, Discord) use threaded replies. Modern platforms (WhatsApp, Google Chat post-2023) use inline replies. Google explicitly deprecated threading because it was confusing. Ripple's inline choice aligns with modern direction.

4. **Skin tones are expected** — All platforms support skin tone variants in 2026. Can defer to v1.1 but users will notice absence.

5. **@channel abuse is real** — Slack requires confirmation for 6+ members. Teams requires admin permission. This should be planned for v1.1.

## Accessibility Considerations

| Feature | Accessibility Requirement | Implementation |
|---------|---------------------------|----------------|
| **Mention autocomplete** | Keyboard navigation (arrow keys, Enter, Esc) | ARIA combobox pattern. Announce "X results" with screen reader. |
| **Mention chips** | Screen reader should announce "@John Doe mentioned" | Use `role="link"` or semantic markup with aria-label. |
| **Emoji picker** | Keyboard navigation, search by name | Use emoji-picker-react which has built-in keyboard support. |
| **Reaction pills** | Screen reader announces "3 people reacted with thumbs up, you reacted" | Proper ARIA labels on buttons. |
| **Reply quote preview** | Screen reader announces "Replying to [author]: [quote text]" | Semantic HTML with aria-describedby linking reply to quoted message. |
| **Jump to message** | Keyboard shortcut to jump (e.g., Cmd+J in Slack) | Optional for v1. Screen reader announces "Jumped to message from [author] at [time]". |

**Note:** Slack is the gold standard for chat accessibility. Reference Slack accessibility documentation for keyboard patterns.

## Technical Implementation Notes

### Schema Changes Required

```typescript
// messages table — ADD these fields
messages: defineTable({
  // ... existing fields ...
  mentionedUserIds: v.optional(v.array(v.string())), // User IDs mentioned in message
  replyToMessageId: v.optional(v.id("messages")), // Message being replied to
})
.index("by_channel", ["channelId"])
.index("by_mentioned_user", ["mentionedUserIds"]) // NEW: for search by mentions

// reactions table — NEW
reactions: defineTable({
  messageId: v.id("messages"),
  userId: v.id("users"),
  emoji: v.string(), // Unicode emoji string
})
.index("by_message", ["messageId"])
.index("by_message_user", ["messageId", "userId"])
.index("by_user", ["userId"])
```

### Reuse Existing Patterns

| Existing Pattern | Reuse For |
|------------------|-----------|
| **UserBlock inline content (task descriptions)** | @mention chips in chat messages |
| **taskCommentSchema with UserMention** | Chat message schema needs same UserMention inline content |
| **Diff-based mention detection (task mutations)** | Chat message edits — prevent duplicate notifications |
| **Push notifications infrastructure** | Mention notifications (already triggers on new message, extend for mentions) |
| **BlockNote rich content rendering** | Quote preview rendering in reply-to |
| **Full-text search on messages** | Extend with mentionedUserIds filter for "messages where I was mentioned" |

### Performance Considerations

| Feature | Scaling Concern | Mitigation |
|---------|----------------|------------|
| **Autocomplete query** | Workspace with 10,000+ users | Limit results to 20, prioritize recent participants (v1.1), debounce input 200ms |
| **Reaction aggregation** | Message with 500+ reactions (viral message) | Index by_message, batch fetch users, use aggregation query pattern |
| **Jump to message** | Scrolling to message from 6 months ago | Use virtualized list (existing MessageList already uses pagination), fetch context around target message |
| **Emoji picker mount** | Mounting picker for every message input | Mount once globally, position near click target. Pattern from emoji-picker-react docs. |

## Edge Cases & Error Handling

| Edge Case | Expected Behavior |
|-----------|-------------------|
| **User deletes account, was mentioned** | Mention chip shows "[Deleted user]" placeholder (same as existing UserBlock pattern) |
| **Reply to deleted message** | Quote preview shows "[Message deleted]" in gray (no author/content) |
| **Mention user not in channel** | Autocomplete shows all workspace members; mentioned user sees notification but can't view message until invited to channel (same as Slack) |
| **React with same emoji twice** | Second click removes reaction (toggle behavior) |
| **Multiple users react with same emoji** | Counter increments, tooltip lists all users ("Alice, Bob, +3 more") |
| **Edit message to remove mention** | Diff algorithm detects removal, no notification sent, no un-notification (can't un-notify) |
| **Message with 50+ reactions** | Show top 5-10 reaction types, "+ X more" button to expand full list (copy Slack pattern) |
| **Autocomplete with no matching users** | Show "No users found" empty state |
| **Reply to own message** | Allowed — useful for adding context or corrections |
| **Circular replies (A replies to B, B replies to A)** | Allowed — quote preview breaks visual cycle |

## Sources

Research findings based on the following sources:

- [Slack Notifications Setup Guide 2026](https://blog.buddieshr.com/slack-notifications-setup-guide/)
- [Use mentions in Slack](https://slack.com/help/articles/205240127-Use-mentions-in-Slack)
- [Use emoji and reactions | Slack](https://slack.com/help/articles/202931348-Use-emoji-and-reactions)
- [Slack emojis: How Emojis Can Boost Team Collaboration](https://blog.attendancebot.com/blog/slack-emojis-reacjis/)
- [Google Workspace Updates: In-line threaded Google Chat (2023)](https://workspaceupdates.googleblog.com/2023/02/new-google-chat-spaces-will-be-in-line-threaded.html)
- [WhatsApp privacy tweak: deleted messages removed from quoted replies](https://www.idownloadblog.com/2025/06/02/meta-privacy-update-whatsapp-deleted-messages-quoted-replies/)
- [Google Chat will now show when someone deletes a message](https://www.androidpolice.com/google-chat-will-now-show-you-when-someone-deletes-a-message/)
- [Chat UX Best Practices: From Onboarding to Re-Engagement](https://getstream.io/blog/chat-ux/)
- [Accessible Autocomplete](https://haltersweb.github.io/Accessibility/autocomplete.html)
- [Building an Emoji Picker with React (2026)](https://jafmah97.medium.com/building-an-emoji-picker-with-react-66f612a43d67)
- [Emoji Picker - React Chat Messaging Docs](https://getstream.io/chat/docs/sdk/react/guides/customization/emoji_picker/)
- [Microsoft Teams new skin tone settings](https://techcommunity.microsoft.com/blog/microsoft365insiderblog/new-skin-tone-settings-in-microsoft-teams/4261358)
- [Notify a channel or workspace | Slack](https://slack.com/help/articles/202009646-Notify-a-channel-or-workspace)
- [Manage who can notify a channel or workspace | Slack](https://slack.com/help/articles/115004855143-Manage-who-can-notify-a-channel-or-workspace)
- [Replies and Threaded Discussions | Pronto](https://support.pronto.io/en/articles/5177869-replies-and-threaded-discussions)
- [Telegram Replies 2.0: Quote specific parts](https://telegram.org/blog/reply-revolution)
- [Message Reactions | Ably Chat](https://ably.com/docs/chat/rooms/message-reactions)
- [Manage Google Chat notifications](https://support.google.com/chat/answer/7655718?hl=en&co=GENIE.Platform%3DDesktop)
- [Manage Microsoft Teams Notifications (2026)](https://www.socialintents.com/blog/how-to-manage-microsoft-teams-notifications/)
- [Designing better nested comments](https://justintadlock.com/archives/2016/11/16/designing-better-nested-comments)
- [16 Chat UI Design Patterns That Work in 2025](https://bricxlabs.com/blogs/message-screen-ui-deisgn)

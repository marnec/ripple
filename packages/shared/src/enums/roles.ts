export const WorkspaceRole = {
    ADMIN : "admin",
    MEMBER : "member"
} as const

export const ChannelRole = {
    ADMIN : "admin",
    MEMBER : "member"
} as const

/**
 * `ChannelType` — the single enum that conflated kind and visibility — was
 * retired here (docs/adr/0001). Its two axes are `ChannelKind` and
 * `ChannelVisibility` below. The retired literals survive only inside
 * `migrations.ts`, which has to read rows a restored backup can reintroduce.
 */
/**
 * The *kind* axis: what a `channels` row is. Distinct from visibility, which
 * only a channel has. See `CONTEXT.md` and `docs/adr/0001`.
 */
export const ChannelKind = {
    CHANNEL: "channel",
    DM: "dm",
} as const

/**
 * The *visibility* axis: who in the workspace may enter a channel. A direct
 * message has none — the value stored on a DM row is a derived constant, never
 * a setting.
 */
export const ChannelVisibility = {
    PUBLIC: "public",
    PRIVATE: "private",
} as const

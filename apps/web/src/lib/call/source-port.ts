import type { Id } from "@convex/_generated/dataModel";

/**
 * Per-call descriptor — the metadata the floating PiP, navigation, and
 * routing all derive from. Set when the user enters the lobby of a call;
 * stays constant for the duration of that session.
 */
export interface CallSourceDescriptor {
  /** Discriminant so PiP can render kind-specific affordances (label prefix, etc.). */
  kind: "channel" | "event";
  /** Stable resource identity (`channelId` or `eventId`). */
  resourceId: string;
  /** Workspace the call is anchored to. Used by source impls; PiP only reads `homePath`/`leaveDestination`. */
  workspaceId: Id<"workspaces">;
  /** Human-readable name shown in the floating window header. */
  label: string;
  /** Route the call lives at (e.g. `.../channels/X/videocall`). `isFloating` flips when the user navigates away. */
  homePath: string;
  /** Where to navigate after a successful leave. */
  leaveDestination: string;
}

/** Preferences captured by the lobby and forwarded to `acquireToken`. */
export interface CallJoinPreferences {
  audioEnabled: boolean;
  videoEnabled: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  audioOutputDeviceId?: string;
  userName: string;
  userImage?: string;
  /**
   * Whether to transcribe this call (saves an end-of-call transcript document
   * via Cloudflare end-of-meeting transcription). Only honoured when this caller
   * starts the call; joiners of an existing call inherit its mode. Channel calls
   * only — event sources ignore it.
   */
  transcribe?: boolean;
}

/** Result from the source's token-minting backend action. */
export interface CallToken {
  authToken: string;
  meetingId: string;
}

/**
 * Polymorphic call source. Each call kind (channel, event) provides one of
 * these to drive the otherwise-uniform lifecycle in `useCallSession`. The
 * port is the only seam between the React lifecycle and Convex/RTK.
 *
 * Sources are plain objects, built freshly each render — `useCallSession`
 * only treats `descriptor.kind` + `descriptor.resourceId` as session
 * identity, so referential churn on the wrapper is harmless.
 */
export interface CallSourcePort {
  descriptor: CallSourceDescriptor;
  /** Mint a join token. Throws on permission/availability error. */
  acquireToken(prefs: CallJoinPreferences): Promise<CallToken>;
  /**
   * Optional cleanup invoked once after the RTK client has cleanly left.
   * Channel sources use it to call `endSession` when they were the last
   * participant; event sources currently leave it unset.
   */
  onAfterLeave?(opts: { remainingParticipants: number }): Promise<void> | void;
}

/**
 * True iff the active call (if any) is for a different resource than the
 * one currently being requested. Both call surfaces (channel, event) use
 * this to decide whether to render `<CallBusyScreen>` instead of their
 * lobby/meeting UI. Centralised here so the test logic is identical
 * across surfaces.
 */
export function isCallBusyForOtherResource(
  active: CallSourceDescriptor | null,
  status: "idle" | "lobby" | "joining" | "joined" | "error",
  requestedResourceId: string,
): boolean {
  if (active === null) return false;
  if (active.resourceId === requestedResourceId) return false;
  // `idle` shouldn't occur with a non-null descriptor in practice, but
  // treat it as "not busy" for safety. `error` we also treat as not
  // busy — the user can re-enter freely from an error state.
  return status !== "idle" && status !== "error";
}

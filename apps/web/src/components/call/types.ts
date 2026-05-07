/**
 * Structural type matching the subset of the Cloudflare RealtimeKit
 * participant object that our tile/grid primitives consume. We type it
 * structurally rather than importing the SDK's full `Participant`
 * interface so the primitives stay decoupled from a specific RTK
 * version's surface.
 */
export interface CallParticipant {
  id: string;
  name: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
  videoTrack: MediaStreamTrack;
  customParticipantId?: string;
  picture?: string;
  registerVideoElement: (el: HTMLVideoElement) => void;
  deregisterVideoElement: (el?: HTMLVideoElement) => void;
}

import { Captions } from "lucide-react";

/**
 * Transcription disclosure for guest call surfaces.
 *
 * Guests reach a call through a public share link and get no lobby, no app
 * chrome, and none of `ActiveCallContext` — so the "Transcribing" pill in
 * `Layout.tsx` never renders for them. Until this existed a guest could be
 * recorded with no indication anywhere on the page.
 *
 * Two pieces, deliberately different in what they claim:
 *
 * - `TranscriptionNotice` is shown *before* joining and is unconditional. The
 *   real mode can only be resolved by asking Cloudflare whether the meeting is
 *   live, which is a `fetch` and therefore an action — a Convex query cannot do
 *   it. Running that action on page load would hand anyone holding a share link
 *   a lever on our RealtimeKit quota, so the pre-join copy says "may be" and
 *   means it.
 * - `TranscriptionPill` is shown *during* the call and is exact: the token
 *   actions return the authoritative `transcribe`, resolved server-side as part
 *   of work they already do.
 */
export function TranscriptionNotice() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-left">
      <Captions className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
      <p className="text-xs text-muted-foreground">
        Calls on this link may be transcribed. If transcription is on, what you
        say is recorded and saved to the workspace after the call ends.
      </p>
    </div>
  );
}

export function TranscriptionPill({ transcribe }: { transcribe: boolean }) {
  if (!transcribe) return null;

  return (
    <span
      className="flex items-center gap-1.5 rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400"
      title="This call is being transcribed. The transcript is saved to the workspace after the call ends."
    >
      <Captions className="h-3 w-3" />
      <span className="hidden sm:inline">Transcribing</span>
    </span>
  );
}

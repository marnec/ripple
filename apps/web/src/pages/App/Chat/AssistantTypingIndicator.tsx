import { useEffect, useState } from "react";
import { AssistantAvatar } from "@/components/AssistantAvatar";
import { cn } from "@/lib/utils";

/**
 * A reply that is late by this much is treated as not coming. The backend
 * clears a pending reply on every way out of the job, so this is a guard
 * against the one thing it cannot cover — a row that outlives its job — not
 * the expected end of the wait. Three attempts with backoff plus one long
 * model call fit comfortably inside it.
 */
const STALE_AFTER_MS = 3 * 60_000;

/**
 * The assistant, writing. Sits where its reply will land — the far side of
 * the conversation on desktop, the "other people" side on mobile — with the
 * avatar and bubble shape the reply itself will have, so the answer replaces
 * it in place rather than appearing somewhere new.
 *
 * `since` is when the newest pending mention was posted; the indicator hides
 * itself once that is `STALE_AFTER_MS` old, and re-shows for a newer one.
 */
export function AssistantTypingIndicator({ name, since }: { name: string; since: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const remaining = since + STALE_AFTER_MS - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(timer);
  }, [since]);

  if (now - since >= STALE_AFTER_MS) return null;

  return (
    <li
      role="status"
      aria-live="polite"
      className="mb-2 flex flex-row items-end text-sm animate-fade-in sm:flex-row-reverse"
    >
      <span className="sr-only">{name} is writing a reply</span>
      <div className="w-9.5 shrink-0 mr-1.5 sm:mr-0 sm:ml-1.5">
        <AssistantAvatar name={name} className="size-8" />
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "flex h-8 w-fit items-center gap-1 rounded-lg bg-muted px-3",
          "bubble-tail-left sm:bubble-tail-right sm:ml-auto",
        )}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 rounded-full bg-foreground animate-typing-dot motion-reduce:animate-none motion-reduce:opacity-35"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
    </li>
  );
}

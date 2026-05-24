import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { SEED_WAIT_TIMEOUT_MS } from "@/hooks/use-description-seed-gate";

const TOTAL_SECONDS = Math.ceil(SEED_WAIT_TIMEOUT_MS / 1000);

/**
 * Disclaimer shown next to the description spinner while a task's description is
 * being seeded from its linked GitHub issue. Rendered only while the seed wait
 * is active (the parent gates on `awaitingSeed`), so it mounts in lockstep with
 * the hook's bounded timeout — letting it count down independently without the
 * hook having to expose a deadline (which would trip render purity rules).
 *
 * The countdown digits are monospace + fixed-width so ticking from "8s" → "7s"
 * never reflows the label to its left.
 */
export function SeedingDescriptionNotice() {
  const [remaining, setRemaining] = useState(TOTAL_SECONDS);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      setRemaining(Math.max(0, Math.ceil((SEED_WAIT_TIMEOUT_MS - elapsed) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground animate-fade-in">
      <GitBranch className="h-3.5 w-3.5 shrink-0" />
      <span>Seeding description from GitHub issue…</span>
      <span className="font-mono tabular-nums w-[2ch] text-right">
        {remaining}s
      </span>
    </div>
  );
}

import { cn } from "@/lib/utils";
import { RippleLogo } from "./RippleLogo";

/**
 * The workspace assistant's face: the Ripple mark on a filled disc, wherever a
 * person would get their photo — the author avatar, the mention chip, the
 * composer's `@` menu.
 *
 * The disc is `foreground` on `background`, the same inversion the "mention of
 * you" chip uses, rather than the app icon's fixed near-black: it is the one
 * avatar that has to read against both themes and against every bubble, and
 * an icon-coloured tile would vanish into the dark theme's surfaces.
 */
export function AssistantAvatar({
  name = "Assistant",
  className,
}: {
  name?: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-foreground text-background",
        className,
      )}
    >
      <RippleLogo className="size-full" />
    </span>
  );
}

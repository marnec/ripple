import { cn } from "@/lib/utils";

/**
 * A small rectangular color tag representing a project's color.
 * Uses typographic units (ch × ex) so it scales with surrounding text and
 * stays proportioned like a letter glyph. Intentionally rectangular (not
 * rounded-full) to visually distinguish from task-status dots.
 */
export function ProjectColorTag({
  color,
  className,
}: {
  color?: string;
  className?: string;
}) {
  if (!color) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block w-[0.8ch] h-[1.4ch] rounded-[2px] shrink-0",
        color,
        className,
      )}
    />
  );
}

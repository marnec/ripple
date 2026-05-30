import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/**
 * Canonical avatar initials: the first letters of the first two words, else the
 * first two characters, else "?". This is the single home for the initials
 * logic that was hand-rolled at ~a dozen call sites in three slightly different
 * forms (`name?.slice(0, 2).toUpperCase() ?? "?"`, `name.charAt(0)`, and a
 * word-split join) — now they all render the same way.
 */
function getAvatarInitials(name?: string | null): string {
  const source = name?.trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/**
 * Image-with-initials-fallback avatar. Wraps the shadcn Avatar primitives so
 * the image/fallback/initials wiring lives in one place instead of being
 * re-spelled at every assignee/member/author render.
 *
 * `className` sizes the Avatar (e.g. `h-6 w-6`); `fallbackClassName` tunes the
 * fallback text (size/colour). Pass a provider login as `name` for external
 * assignees — `getAvatarInitials` degrades to the first two characters for a
 * single token, matching the old `login.slice(0, 2)` behaviour.
 */
export function UserAvatar({
  name,
  image,
  className,
  fallbackClassName,
  alt,
}: {
  name?: string | null;
  image?: string | null;
  className?: string;
  fallbackClassName?: string;
  alt?: string;
}) {
  return (
    <Avatar className={className}>
      {image && <AvatarImage src={image} alt={alt ?? name ?? ""} />}
      <AvatarFallback className={fallbackClassName}>
        {getAvatarInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

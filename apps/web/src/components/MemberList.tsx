import type { ReactNode } from "react";
import { Search, Shield, UserMinus } from "lucide-react";

import { UserAvatar } from "@/components/UserAvatar";
import type { MemberRole } from "@/lib/member-list";
import { cn } from "@/lib/utils";
import { Badge } from "@ripple/ui/components/badge";
import { Button } from "@ripple/ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@ripple/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ripple/ui/components/select";

/**
 * The one members list. Workspace settings and channel settings both manage
 * "people plus a role", and used to do it with two hand-rolled row layouts
 * that had drifted apart: a generic person glyph instead of the avatar every
 * other surface shows, no email, `ADMIN` / `MEMBER` shouted in one role picker
 * and `Admin` / `Member` in the other, a browser `confirm()` on one remove
 * button and nothing at all on the other.
 *
 * So the row anatomy lives here and the sections only supply the actions they
 * are allowed to render:
 *
 *   [avatar]  Name  You            [role control]  [remove]
 *             email, hints
 *
 * `WorkspaceRole` and `ChannelRole` are the same two literals, which is why a
 * single role control can serve both. If a third role ever appears on one of
 * the axes, `MemberRoleSelect` takes options rather than growing a variant.
 */

/** A framed, divided list. One border around the group, not one per row. */
export function MemberList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="list"
      className={cn("divide-y overflow-hidden rounded-lg border", className)}
    >
      {children}
    </div>
  );
}

export function MemberListItem({
  name,
  email,
  image,
  isSelf = false,
  /** Short muted notes under the name (e.g. "Not connected to GitHub"). */
  hints,
  children,
}: {
  name: string;
  email?: string;
  image?: string | null;
  isSelf?: boolean;
  hints?: ReadonlyArray<{ label: string; title?: string }>;
  children?: ReactNode;
}) {
  // A member with no display name is shown by email, and repeating it on the
  // second line says nothing twice.
  const showEmail = email !== undefined && email !== name;

  return (
    <div
      role="listitem"
      className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
    >
      <UserAvatar
        name={name}
        image={image}
        className="size-8 shrink-0"
        fallbackClassName="text-xs"
      />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{name}</span>
          {isSelf && (
            <span className="shrink-0 text-xs text-muted-foreground">You</span>
          )}
        </div>
        {(showEmail || hints?.length) && (
          <div className="flex min-w-0 items-center gap-1.5">
            {showEmail && (
              <span className="truncate text-xs text-muted-foreground">
                {email}
              </span>
            )}
            {hints?.map((hint) => (
              <Badge
                key={hint.label}
                variant="outline"
                className="h-4 shrink-0 px-1.5 text-[10px] font-normal text-muted-foreground"
                title={hint.title}
              >
                {hint.label}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {children && (
        <div className="flex shrink-0 items-center gap-1">{children}</div>
      )}
    </div>
  );
}

/**
 * The role a viewer cannot change, shown only when it carries information:
 * everyone is a member, so only "Admin" is worth a badge.
 */
export function MemberRoleBadge({ role }: { role: MemberRole }) {
  if (role !== "admin") return null;
  return (
    <Badge variant="secondary" className="gap-1 font-normal">
      <Shield />
      Admin
    </Badge>
  );
}

const ROLE_OPTIONS: ReadonlyArray<{ value: MemberRole; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
];

export function MemberRoleSelect({
  value,
  onValueChange,
  memberName,
  options = ROLE_OPTIONS,
}: {
  value: MemberRole;
  onValueChange: (role: MemberRole) => void;
  /** Names the control for screen readers, since the row has no visible label. */
  memberName: string;
  options?: ReadonlyArray<{ value: MemberRole; label: string }>;
}) {
  return (
    <Select
      value={value}
      onValueChange={(role) => {
        // base-ui hands back `null` when a selection is cleared; the row has
        // no "no role" state, so ignore it rather than writing an empty role.
        if (role !== null) onValueChange(role);
      }}
    >
      <SelectTrigger size="sm" className="w-27.5" aria-label={`Role of ${memberName}`}>
        {/* base-ui renders the raw value unless the label is spelled out, which
            is how one picker used to read "member" and the other "MEMBER". */}
        <SelectValue>
          {(role: string) =>
            options.find((option) => option.value === role)?.label ?? role
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function RemoveMemberButton({
  memberName,
  onClick,
}: {
  memberName: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      aria-label={`Remove ${memberName}`}
      title={`Remove ${memberName}`}
      className="text-muted-foreground hover:text-destructive"
    >
      <UserMinus className="size-4" />
    </Button>
  );
}

export function MemberListEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * Reserved space while the roster loads. Matches the height of a short list so
 * the panel does not jump when rows arrive (the house rule is no skeletons).
 */
export function MemberListPlaceholder() {
  return <div className="min-h-32 rounded-lg border" aria-hidden="true" />;
}

/** "12 members", or "3 of 12 members" while a filter is narrowing the list. */
export function MemberCount({ shown, total }: { shown: number; total: number }) {
  const noun = total === 1 ? "member" : "members";
  return (
    <p className="text-xs text-muted-foreground">
      {shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`}
    </p>
  );
}

export function MemberSearchInput({
  value,
  onChange,
  placeholder = "Search members",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <InputGroup className="w-full sm:w-56">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </InputGroup>
  );
}

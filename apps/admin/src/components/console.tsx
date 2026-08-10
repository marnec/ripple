import { SearchIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@ripple/ui/components/avatar";
import { Card } from "@ripple/ui/components/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@ripple/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@ripple/ui/components/input-group";
import { Spinner } from "@/components/ui/spinner";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/* Console-specific compositions on top of the shadcn primitives in
   `components/ui` (which are CLI-generated — edit the tokens in index.css or
   compose here instead of touching them). */

// ── Page scaffolding ─────────────────────────────────────────────────────
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Right-hand slot: search box, destructive actions, … */
  children?: ReactNode;
}) {
  return (
    <header className="animate-rise flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 min-h-5 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </header>
  );
}

/** The filter box every list page carries in its header. */
export function SearchInput({
  value,
  onValueChange,
  placeholder,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <InputGroup className={cn("h-9 w-full max-w-xs", className)}>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        value={value}
        placeholder={placeholder}
        onChange={(e) => onValueChange(e.target.value)}
      />
    </InputGroup>
  );
}

export function SectionLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <h2
      className={cn(
        "font-mono text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </h2>
  );
}

/** Full-height centred spinner for a page- or section-level blocking load. */
export function LoadingPane({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-h-[60vh] items-center justify-center", className)}>
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}

export function EmptyState({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <Empty className="min-h-30 py-10">
      <EmptyHeader>
        {title && <EmptyTitle>{title}</EmptyTitle>}
        {children && <EmptyDescription>{children}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}

// ── Identity ─────────────────────────────────────────────────────────────
export function UserAvatar({
  name,
  email,
  image,
  size = "default",
  className,
}: {
  name?: string;
  email?: string;
  image?: string;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback className="font-mono text-[11px]">{initials(name, email)}</AvatarFallback>
    </Avatar>
  );
}

// ── Metrics ──────────────────────────────────────────────────────────────
export function StatCard({
  label,
  value,
  sub,
  accent,
  delay = 0,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: boolean;
  delay?: number;
}) {
  return (
    <Card className="animate-rise gap-0 p-4" style={{ animationDelay: `${delay}ms` }}>
      <div className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 font-mono text-3xl font-semibold tabular-nums",
          accent ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

// ── Destructive-action dialogs ───────────────────────────────────────────
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={danger ? "destructive" : "default"}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Destructive action gated behind typing an exact phrase (name, email, …). */
export function TypeToConfirmDialog({
  open,
  title,
  description,
  phrase,
  confirmLabel = "Delete",
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  phrase: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  // Reset the typed phrase when the dialog (re)opens — done during render via
  // the previous-value pattern rather than in an effect (no setState-in-effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTyped("");
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent className="ring-destructive/30">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <div className="space-y-1.5 text-left">
          <p className="text-xs text-muted-foreground">
            Type <span className="font-mono text-foreground">{phrase}</span> to confirm.
          </p>
          <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={typed !== phrase || loading}
            onClick={onConfirm}
          >
            {loading ? "Deleting…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

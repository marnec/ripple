import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { initials } from "../lib/format";

/* Hand-built shadcn-flavoured primitives. Kept in one file because the set is
   small; promote to separate files (or swap for real shadcn/base-ui) later. */

// ── Spinner ──────────────────────────────────────────────────────────────
export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "size-5 animate-spin rounded-full border-2 border-stone-700 border-t-accent",
        className,
      )}
    />
  );
}

// ── Card / Panel ───────────────────────────────────────────────────────────
export function Card({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={style}
      className={cn("rounded-lg border border-stone-800 bg-stone-900/40", className)}
    >
      {children}
    </div>
  );
}

// ── Section label (uppercase micro-label) ───────────────────────────────────
export function SectionLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <h2
      className={cn(
        "font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500",
        className,
      )}
    >
      {children}
    </h2>
  );
}

// ── Badge ────────────────────────────────────────────────────────────────
type BadgeVariant = "muted" | "accent" | "outline" | "success" | "danger";
const badgeVariants: Record<BadgeVariant, string> = {
  muted: "bg-stone-800 text-stone-300",
  accent: "bg-accent-dim text-accent ring-1 ring-inset ring-accent/30",
  outline: "text-stone-400 ring-1 ring-inset ring-stone-700",
  success: "bg-emerald-500/12 text-emerald-400 ring-1 ring-inset ring-emerald-500/25",
  danger: "bg-red-500/12 text-red-400 ring-1 ring-inset ring-red-500/25",
};
export function Badge({
  variant = "muted",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-wide",
        badgeVariants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ── Button ─────────────────────────────────────────────────────────────────
type ButtonVariant = "default" | "accent" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "default" | "icon";
const buttonVariants: Record<ButtonVariant, string> = {
  default: "bg-stone-100 text-stone-900 hover:bg-white",
  accent: "bg-accent text-stone-950 hover:brightness-110",
  outline: "border border-stone-700 text-stone-200 hover:bg-stone-800/70",
  ghost: "text-stone-300 hover:bg-stone-800/70",
  danger: "border border-red-500/40 text-red-400 hover:bg-red-500/10",
};
const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  default: "h-9 px-3.5 text-sm gap-2",
  icon: "size-9",
};
export function Button({
  variant = "outline",
  size = "default",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  );
}

// ── Input (with optional leading icon) ──────────────────────────────────────
export function Input({
  className,
  icon,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500">
          {icon}
        </span>
      )}
      <input
        className={cn(
          "h-9 w-full rounded-md border border-stone-700 bg-stone-900/60 px-3 text-sm text-stone-100 placeholder:text-stone-500 outline-none transition-colors focus:border-accent/60 focus:bg-stone-900",
          icon && "pl-9",
          className,
        )}
        {...props}
      />
    </div>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────────────
export function Avatar({
  name,
  email,
  image,
  className,
}: {
  name?: string;
  email?: string;
  image?: string;
  className?: string;
}) {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        className={cn("size-8 rounded-full object-cover ring-1 ring-stone-700", className)}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex size-8 items-center justify-center rounded-full bg-stone-800 font-mono text-[11px] font-medium text-stone-300 ring-1 ring-stone-700",
        className,
      )}
    >
      {initials(name, email)}
    </div>
  );
}

// ── StatCard ─────────────────────────────────────────────────────────────────
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
    <Card className="animate-rise p-4" style={{ animationDelay: `${delay}ms` }}>
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-stone-500">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 font-mono text-3xl font-semibold tabular-nums",
          accent ? "text-accent" : "text-stone-100",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-stone-500">{sub}</div>}
    </Card>
  );
}

// ── EmptyState ───────────────────────────────────────────────────────────────
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center px-6 py-10 text-center text-sm text-stone-500">
      {children}
    </div>
  );
}

// ── ConfirmDialog (portal modal) ─────────────────────────────────────────────
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="animate-overlay fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="animate-rise w-full max-w-sm rounded-lg border border-stone-800 bg-stone-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-stone-100">{title}</h3>
        {description && <p className="mt-2 text-sm text-stone-400">{description}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "accent"}
            size="sm"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── TypeToConfirmDialog (gated destructive action) ──────────────────────────
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
  /** The user must type this exactly to enable the confirm button. */
  phrase: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) return;
    setTyped("");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const armed = typed === phrase && !loading;

  return createPortal(
    <div
      className="animate-overlay fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="animate-rise w-full max-w-sm rounded-lg border border-red-500/30 bg-stone-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-stone-100">{title}</h3>
        {description && <p className="mt-2 text-sm text-stone-400">{description}</p>}
        <p className="mt-4 text-xs text-stone-500">
          Type <span className="font-mono text-stone-300">{phrase}</span> to confirm.
        </p>
        <Input
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-1.5"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={!armed}>
            {loading ? "Deleting…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { Label } from "@/components/ui/label";

type PropertyRowProps = {
  label: string;
  alignTop?: boolean;
  children: React.ReactNode;
};

export function PropertyRow({ label, alignTop, children }: PropertyRowProps) {
  return (
    <div className={`grid grid-cols-[5.5rem_1fr] md:grid-cols-3 gap-x-2 md:gap-x-4 ${alignTop ? "items-start" : "items-center"}`}>
      <Label className={`text-sm text-muted-foreground ${alignTop ? "pt-2" : ""}`}>{label}</Label>
      <div className="md:col-span-2 min-w-0">{children}</div>
    </div>
  );
}

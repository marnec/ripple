import { Label } from "@/components/ui/label";

type PropertyRowProps = {
  label: string;
  alignTop?: boolean;
  children: React.ReactNode;
};

export function PropertyRow({ label, alignTop, children }: PropertyRowProps) {
  return (
    <div className={`grid grid-cols-3 gap-4 ${alignTop ? "items-start" : "items-center"}`}>
      <Label className={`text-sm ${alignTop ? "pt-2" : ""}`}>{label}</Label>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

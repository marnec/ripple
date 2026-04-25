import { RippleLogoCanvas } from "@/components/RippleLogoCanvas";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh flex items-center justify-center bg-black text-white px-4 py-8 sm:px-8">
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
            backgroundSize: "32px 32px",
          }}
        />
      </div>

      <div className="relative w-full max-w-100 flex flex-col items-center">
        <RippleLogoCanvas className="size-80 -mb-16 animate-[fade-in_1s_ease] text-white" />
        <div className="w-full">{children}</div>
      </div>
    </div>
  );
}

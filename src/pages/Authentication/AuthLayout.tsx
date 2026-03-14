import { RippleLogo } from "@/components/RippleLogo";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh">
      {/* Brand panel — desktop only */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-[50%] relative overflow-hidden bg-foreground items-center justify-center">
        <div className="absolute inset-0 opacity-[0.03]">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
              backgroundSize: "32px 32px",
            }}
          />
        </div>

        <div className="relative flex flex-col items-center gap-6 text-background">
          <div className="relative">
            <RippleLogo className="size-28 animate-[fade-in_1s_ease]" />
            {/* Animated ripple rings behind logo */}
            <div className="absolute inset-0 -m-12">
              <svg
                viewBox="0 0 200 200"
                className="size-full"
                aria-hidden="true"
              >
                <circle
                  cx="100"
                  cy="100"
                  r="70"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.5"
                  opacity="0.15"
                  className="animate-[pulse_4s_ease-in-out_infinite]"
                />
                <circle
                  cx="100"
                  cy="100"
                  r="90"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.5"
                  opacity="0.08"
                  className="animate-[pulse_4s_ease-in-out_1s_infinite]"
                />
              </svg>
            </div>
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight">Ripple</h1>
            <p className="mt-2 text-sm opacity-60">
              Collaborative workspace for teams
            </p>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-[400px]">
            {/* Mobile logo */}
            <div className="flex flex-col items-center mb-8 lg:hidden">
              <RippleLogo className="size-12 text-foreground" />
              <span className="mt-3 text-lg font-semibold tracking-tight">
                Ripple
              </span>
            </div>

            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

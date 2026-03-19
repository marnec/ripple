if (import.meta.env.DEV) {
  await import("./wdyr");
}
// Install Temporal on globalThis for @schedule-x/calendar (which reads it as a global).
// We intentionally do NOT use 'temporal-polyfill/global' — that entry point also patches
// Intl.DateTimeFormat and Date.prototype, which wraps the global constructor and slows
// down every navigation that internally calls new Intl.DateTimeFormat().
import { Temporal as _Temporal } from "temporal-polyfill";
(globalThis as Record<string, unknown>).Temporal = _Temporal;
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { LazyMotion, domMax } from "framer-motion";
import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PwaUpdateProvider } from "./hooks/use-pwa-update";
import "./index.css";
import { router } from "./routes.tsx";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider attribute="class">
        <PwaUpdateProvider>
          <Toaster />
          <ConvexAuthProvider client={convex}>
            <LazyMotion features={domMax} strict>
              <RouterProvider router={router} />
            </LazyMotion>
          </ConvexAuthProvider>
        </PwaUpdateProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

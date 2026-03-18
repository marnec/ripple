if (import.meta.env.DEV) {
  await import("./wdyr");
}
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { LazyMotion, domAnimation } from "framer-motion";
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
            <LazyMotion features={domAnimation} strict>
              <RouterProvider router={router} />
            </LazyMotion>
          </ConvexAuthProvider>
        </PwaUpdateProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

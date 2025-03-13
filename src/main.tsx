import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "./components/ui/toaster.tsx";
import "./events.ts";
import "./index.css";
import { router } from "./routes.tsx";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* this metadata tag allows correct resizing of the viewport when the elements
     on mobile device browsers (top bar, virtual keyboard) are visible */}
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, interactive-widget=resizes-content"
    />
    <ThemeProvider attribute="class">
      <Toaster />
      <ConvexAuthProvider client={convex}>
        <RouterProvider router={router} />
      </ConvexAuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { ConvexReactClient } from "convex/react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.tsx";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class">
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/workspaces/:workspaceId" element={<App />} />
          </Routes>
        </BrowserRouter>
      </ConvexAuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

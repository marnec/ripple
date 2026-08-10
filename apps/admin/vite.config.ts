import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

// Mirrors apps/web's config minus the PWA plugin (the admin tool isn't
// installable). React Compiler is enabled here too, so the same "no
// useCallback/useMemo" rule applies.
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    tailwindcss(),
    mkcert(),
  ],
  optimizeDeps: {
    // Same reason as apps/web: the workspace packages are raw TypeScript source,
    // not built deps. Pre-bundling them would take their edits out of the HMR
    // graph and turn every change into a dep re-optimize + full reload.
    exclude: ["@ripple/shared", "@ripple/ui"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../../packages/shared/src"),
      "@convex": path.resolve(__dirname, "../convex/convex"),
    },
  },
});

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
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../../packages/shared/src"),
      "@convex": path.resolve(__dirname, "../convex/convex"),
    },
  },
});

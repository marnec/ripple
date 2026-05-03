/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mkcert from "vite-plugin-mkcert";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    mkcert(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "Ripple",
        short_name: "Ripple",
        description: "Real-time collaborative workspace",
        start_url: "/",
        display: "standalone",
        background_color: "#0c0a09",
        theme_color: "#0c0a09",
        orientation: "portrait-primary",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        categories: ["productivity", "collaboration"],
      },
      injectManifest: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10 MB
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  test: {
    name: "frontend",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
  css: { devSourcemap: true },
  build: { sourcemap: true },
  optimizeDeps: { esbuildOptions: { sourcemap: true } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../../packages/shared/src"),
      "@convex": path.resolve(__dirname, "../convex/convex"),
    },
  },
});

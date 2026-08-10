// `cn` lives in the shared primitives package so that the components there and
// the app-local ones that compose them dedupe classes with the same instance.
// Re-exported under the app's own `@/lib/utils` path, which is where the shadcn
// components expect to find it and what the rest of the app already imports.
export { cn } from "@ripple/ui/lib/utils";

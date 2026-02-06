import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "convex/_generated/**",
      "postcss.config.js",
      "tailwind.config.js",
      "vite.config.ts",
      "src/components/ui/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // All of these overrides ease getting into
      // TypeScript, and can be removed for stricter
      // linting down the line.

      // Only warn on unused variables, and ignore variables starting with `_`
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],

      // Allow escaping the compiler
      "@typescript-eslint/ban-ts-comment": "error",

      // Allow explicit `any`s
      "@typescript-eslint/no-explicit-any": "off",

      // START: Allow implicit `any`s
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // END: Allow implicit `any`s

      // Allow async functions without await
      // for consistency (esp. Convex `handler`s)
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // BlockNote block specs export non-component objects from createReactBlockSpec/createReactInlineContentSpec
    files: ["src/pages/App/Document/CustomBlocks/**"],
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // BlockNote inline content specs export non-component objects from createReactInlineContentSpec
    files: ["src/pages/App/Project/CustomInlineContent/**", "src/pages/App/Chat/CustomInlineContent/**"],
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
);

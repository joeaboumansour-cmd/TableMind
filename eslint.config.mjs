import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Build-time PostCSS plugins are loaded by Next through require(), so they
  // have to be CommonJS. The TS import rules do not apply to them.
  {
    files: ["scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Playwright's fixture API hands each fixture a callback named `use`, which
  // the react-hooks rule mistakes for a React hook called outside a component.
  // It is not one — there is no React in the E2E harness at all. Scoped to the
  // one directory rather than disabled globally.
  {
    files: ["harness/e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);

export default eslintConfig;

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
    // The isolated build:check output — linting compiled/minified output here
    // produced tens of thousands of bogus errors and made `npm run lint` useless.
    ".next-build/**",
  ]),
  {
    rules: {
      // The newest eslint-plugin-react-hooks advisories flag common, working
      // patterns wholesale — setState in a fetch-on-mount effect, Date.now() in
      // render for a live clock. They aren't correctness bugs, and "fixing" 22
      // call sites across 16 files would be a large no-op refactor. Keep them as
      // visible warnings instead of blocking errors.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
]);

export default eslintConfig;

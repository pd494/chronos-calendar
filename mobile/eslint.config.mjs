import effectPlugin from "@effect/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

export default defineConfig([
  expoConfig,
  globalIgnores([".expo/**", "dist/**"]),
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "@effect": effectPlugin,
    },
    rules: {
      "@effect/no-import-from-barrel-package": [
        "error",
        { packageNames: ["effect"] },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
]);

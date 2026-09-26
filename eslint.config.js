import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-console": ["warn", { allow: ["error", "warn", "log"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Tests may assert on values the types cannot narrow.
    files: ["**/test/**/*.ts", "scripts/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
);

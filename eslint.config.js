import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const typescriptFiles = ["src/**/*.{ts,tsx}", "server/**/*.ts", "tests/**/*.ts", "e2e/**/*.ts", "*.config.ts"];

export default tseslint.config(
  { ignores: ["dist", "dist-server", "coverage", "playwright-report", "test-results", "src/lib/database.types.ts"] },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: typescriptFiles })),
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        ignoreRestSiblings: true,
        varsIgnorePattern: "^_"
      }]
    }
  }
);

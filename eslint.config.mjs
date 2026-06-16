import js from "@eslint/js";
import globals from "globals";
import ts from "typescript-eslint";

export default [
  { languageOptions: { globals: globals.node } },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["bin/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: [
      "**/*.{test,spec}.{js,jsx,ts,tsx}",
      "**/tests/**/*.{js,jsx,ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    ignores: ["dist/", "coverage/"],
  },
];

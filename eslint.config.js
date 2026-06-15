import js from "@eslint/js";
import react from "eslint-plugin-react";

export default [
  {
    ignores: ["artifacts*/**", "dist/**", "node_modules/**", "release/**", "releases/**"]
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,cjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        AbortController: "readonly",
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        window: "readonly",
        navigator: "readonly",
        process: "readonly",
        require: "readonly",
        __dirname: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly"
      }
    },
    plugins: {
      react
    },
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "react/jsx-uses-vars": "error",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off"
    },
    settings: {
      react: {
        version: "detect"
      }
    }
  }
];

import tsParser from "@typescript-eslint/parser";

/**
 * Architectural boundary enforcement.
 *
 * The approved architecture depends on one property above all others: the
 * intelligence engine must never touch a framework, the network or the file
 * system. That property is not maintained by good intentions — it is
 * maintained by this file, and by the test in tests/lint that proves the rule
 * actually fires.
 */
const ENGINE_FORBIDDEN = [
  { group: ["react", "react-*", "react/*"], message: "engine/ must not import React. Design logic belongs outside the UI." },
  { group: ["next", "next/*"], message: "engine/ must not import Next.js. The engine is framework-free." },
  { group: ["@supabase/*"], message: "engine/ must not import Supabase. Persistence belongs in services/repositories." },
  { group: ["fs", "node:fs", "fs/*", "node:fs/*", "path", "node:path", "os", "node:os"], message: "engine/ must not touch the file system. Datasets are injected as a DatasetRegistry argument." },
  { group: ["http", "https", "node:http", "node:https", "axios", "node-fetch", "undici"], message: "engine/ must not perform network I/O. Use a port interface and inject an adapter." },
  { group: ["../adapters/*", "../../adapters/*", "../../../adapters/*", "@/adapters/*"], message: "engine/ must not import adapters. Depend on the port interface instead." },
  { group: ["../services/*", "../../services/*", "../../../services/*", "@/services/*"], message: "engine/ must not import services. Dependencies point inward, never outward." },
  { group: ["../data/loader", "../../data/loader", "../../../data/loader", "@/data/loader"], message: "engine/ must not import the dataset loader — it reads from disk. Accept a DatasetRegistry argument." }
];

export default [
  {
    ignores: ["node_modules/**", ".next/**", "*.config.mjs", "*.config.ts"]
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module"
    },
    rules: {
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error"
    }
  },
  {
    files: ["engine/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ENGINE_FORBIDDEN }],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "engine/ must not perform network I/O. Inject a port instead." },
        { name: "window", message: "engine/ must not reference the browser." },
        { name: "document", message: "engine/ must not reference the DOM." },
        { name: "localStorage", message: "engine/ must be stateless." }
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "engine/ must be deterministic: inject ClockPort instead of reading the clock."
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: "engine/ must be deterministic: no Math.random()."
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "engine/ must be deterministic: inject ClockPort instead of reading the clock."
        }
      ]
    }
  },
  {
    files: ["data/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../engine/*", "@/engine/*"], message: "data/ must not depend on the engine. Data is inert." },
            { group: ["react", "next", "next/*"], message: "data/ must not import framework code." }
          ]
        }
      ]
    }
  },
  {
    files: ["components/**/*.tsx", "app/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../data/loader", "@/data/loader"], message: "UI must not load datasets directly. Go through a service." }
          ]
        }
      ]
    }
  }
];

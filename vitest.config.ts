import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false
  },
  resolve: {
    alias: {
      "@/types": fileURLToPath(new URL("./types", import.meta.url)),
      "@/engine": fileURLToPath(new URL("./engine", import.meta.url)),
      "@/domain": fileURLToPath(new URL("./domain", import.meta.url)),
      "@/data": fileURLToPath(new URL("./data", import.meta.url)),
      "@/ports": fileURLToPath(new URL("./ports", import.meta.url)),
      "@/tests": fileURLToPath(new URL("./tests", import.meta.url))
    }
  }
});

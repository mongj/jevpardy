import { defineConfig } from "vitest/config";

// The game engine is runtime-agnostic, so tests run in plain Node without the Workers plugin.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});

import { defineComputeConfig } from "@prisma/compute-sdk/config";

// This is a monorepo: the deployable Node/Express API lives under `backend/`
// (its own package.json, build via `tsc` to `dist/index.js`, entry source
// `src/index.ts`) and the React/Vite SPA lives under `frontend/` as a
// separate, statically-built app. Without this file, Prisma Compute's
// auto-deploy tried to build the whole repo as a single app from the
// repository root, which has no package.json - hence the prior
// "ENOENT ... /build/app/package.json" failure.
//
// `framework` is intentionally omitted for the backend app: it's plain
// Express, which is not one of Prisma Compute's documented supported
// frameworks (Next.js/Nuxt/Astro/Hono/NestJS/TanStack Start/Bun) as of this
// writing, so declaring one would be inaccurate. Leaving it unset lets
// Compute's own auto-detection decide, rather than us guessing wrong.
export default defineComputeConfig({
  apps: {
    backend: {
      root: "backend",
      entry: "src/index.ts",
    },
  },
});

<!-- Short, focused guidance for AI coding agents working in this repo -->
# Copilot / AI agent instructions — ZLE E‑shop

Purpose: give an AI coding agent the minimum, high-value knowledge to be productive immediately.

- Repo layout: `client/` (Vite + React + Tailwind + shadcn/ui), `server/` (Express + Drizzle ORM), `shared/` (TS schemas), `script/` (dev/bootstrap + build tooling).

- How to run (dev):
  - Install deps: `npm install`
  - Bootstrap environment (recommended): `node script/bootstrap.mjs` (starts DB, runs migrations, launches dev server)
  - Or run directly: `npm run dev` (uses `tsx server/index.ts`). Default port: 5000.

- Build & deploy:
  - `npm run build` -> runs `script/build.ts`: builds client with Vite, bundles server with esbuild into `dist/index.cjs`.
  - `npm start` -> `node dist/index.cjs`
  - Note: when adding server runtime dependencies that must be bundled for cold-start performance, add them to the `allowlist` in `script/build.ts`.

- Database / migrations / seed:
  - Drizzle is used; `drizzle-kit` is available in `devDependencies` and `npm run db:push` exists.
  - Seeding script: `server/seed.ts` (run `npm run db:seed`).
  - Production: README warns not to use `db:push` in prod — prefer migration workflow (see `drizzle.config.ts`).

- Feature flags & env patterns (critical):
  - `server/env.ts` centralizes feature detection and env defaults. Read it before changing behavior.
  - Common flags: `ENABLE_AUTH`, `ENABLE_STRIPE`, `ENABLE_EMAIL`, `ENABLE_OPS`, `SEED_ON_START`.
  - Example for quick local run without payments/auth: `ENABLE_AUTH=false ENABLE_STRIPE=false npm run dev`.
  - `SESSION_SECRET` is generated ephemeral in dev if missing; sessions won't persist across restarts.

- Important conventions and pitfalls for agents:
  - The app supports a “no database” fallback (see `flags.HAS_DATABASE` in `server/env.ts`). Make checks for `flags.HAS_DATABASE` before adding DB assumptions.
  - `isReplit` detection changes defaults (auth and some integrations). Do not assume Replit-only behavior in local runs.
  - When changing server start behavior, remember the production entrypoint is `dist/index.cjs` (built by `script/build.ts`).
  - When adding runtime-only server deps that must be bundled for production cold-start, add them to `allowlist` in `script/build.ts` or they will be treated as externals by esbuild.

- Where to look for examples:
  - Env/flags, health and startup table: `server/env.ts`
  - Server entrypoint: `server/index.ts`
  - Build pipeline and allowlist: `script/build.ts`
  - Bootstrap/dev orchestration: `script/bootstrap.mjs`
  - Frontend config: `vite.config.ts`, `tailwind.config.ts`, `client/` code

- Quick debugging hooks:
  - Health check: `GET /health` (prints enabled features + DB status).
  - Startup prints a status table (from `server/env.ts`) — useful to verify feature flags and missing secrets.

- PR / change guidance for agents:
  - Mention which environment you used to test changes (local / codespace / Replit) and which env vars were set.
  - If touching DB schema: prefer migration files (Drizzle migrations) and call out `db:seed` usage for local testing.
  - If adding server runtime libs, update `script/build.ts` allowlist and ensure `npm run build` still produces `dist/index.cjs` without missing modules.

If anything here is unclear or you want the file translated/expanded (e.g., add more code examples), say which section and I will iterate.

// script/build.ts
import fs from "fs";
import path from "path";
import { build } from "esbuild";

const isProd = process.env.NODE_ENV === "production";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const deps = Object.keys(packageJson.dependencies || {});
const devDeps = Object.keys(packageJson.devDependencies || {});
const allDeps = Array.from(new Set([...deps, ...devDeps]));

const allowlist = [
  "react",
  "react-dom",
  "wouter",
  "lucide-react",
  "zod",
  "drizzle-orm",
  "drizzle-zod",
  "@neondatabase/serverless",
  "ws",
];

const external = allDeps.filter((d) => !allowlist.includes(d));

const outfile = path.resolve("dist", "index.cjs");

build({
  entryPoints: ["server/index.ts"],
  outfile,
  platform: "node",
  format: "cjs",
  target: "node20",
  bundle: true,
  external,
  define: {
    "process.env.NODE_ENV": JSON.stringify(isProd ? "production" : "development"),
  },

  // ✅ DEBUG MODE (ať Render ukáže skutečný error)
  minify: false,
  sourcemap: true,
}).catch(() => process.exit(1));

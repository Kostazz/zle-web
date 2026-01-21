import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

// Minimal allowlist:
// Keep only deps that are commonly ESM-only or tricky when required from a CJS bundle.
// Everything else stays external and will be loaded from node_modules at runtime.
const allowlist = [
  "@neondatabase/serverless",
  "drizzle-orm",
  "drizzle-zod",
  "express-rate-limit",
  "helmet",
  // NOTE: If you ever hit runtime issues with CJS require() for another package,
  // add it here to bundle it.
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];

  // externalize everything that is NOT in allowlist
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});

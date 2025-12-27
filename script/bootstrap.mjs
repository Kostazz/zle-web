#!/usr/bin/env node

/**
 * ZLE Bootstrap Script
 * One command to start the dev environment:
 * 1. Start Docker (if docker-compose.yml exists)
 * 2. Wait for PostgreSQL
 * 3. Run migrations
 * 4. Optionally seed
 * 5. Start dev server
 */

import { spawn, execSync } from "child_process";
import { existsSync } from "fs";
import { createConnection } from "net";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const POSTGRES_HOST = process.env.PGHOST || "localhost";
const POSTGRES_PORT = parseInt(process.env.PGPORT || "5432", 10);
const MAX_WAIT_SECONDS = 60;

function log(step, message) {
  console.log(`\n┌─ [${step}] ─────────────────────────────`);
  console.log(`│  ${message}`);
  console.log(`└──────────────────────────────────────────\n`);
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
      ...options,
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}: ${cmd} ${args.join(" ")}`));
      }
    });

    proc.on("error", reject);
  });
}

async function waitForPostgres() {
  log("DB", `Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}...`);

  const startTime = Date.now();
  const timeout = MAX_WAIT_SECONDS * 1000;

  while (Date.now() - startTime < timeout) {
    try {
      await new Promise((resolve, reject) => {
        const socket = createConnection(POSTGRES_PORT, POSTGRES_HOST);
        socket.on("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.on("error", reject);
        socket.setTimeout(1000, () => {
          socket.destroy();
          reject(new Error("timeout"));
        });
      });
      console.log("│  PostgreSQL is ready!");
      return true;
    } catch {
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.warn("\n│  ⚠ PostgreSQL not ready after timeout - continuing anyway");
  return false;
}

async function main() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║         ZLE Development Bootstrap         ║");
  console.log("╚══════════════════════════════════════════╝");

  // Step 1: Start Docker if docker-compose.yml exists
  const dockerComposePath = path.join(ROOT, "docker-compose.yml");
  if (existsSync(dockerComposePath)) {
    log("1/5", "Starting Docker containers...");
    try {
      await runCommand("docker", ["compose", "up", "-d"]);
    } catch (e) {
      console.warn("│  ⚠ Docker compose failed - continuing without local DB");
      console.warn("│  Make sure DATABASE_URL is set if using external DB");
    }
  } else {
    log("1/5", "No docker-compose.yml found - skipping Docker setup");
  }

  // Step 2: Wait for PostgreSQL
  if (process.env.DATABASE_URL || existsSync(dockerComposePath)) {
    log("2/5", "Checking database connection...");
    await waitForPostgres();
  } else {
    log("2/5", "No DATABASE_URL set - running in no-db mode");
  }

  // Step 3: Install dependencies if needed
  const nodeModulesPath = path.join(ROOT, "node_modules");
  if (!existsSync(nodeModulesPath)) {
    log("3/5", "Installing dependencies...");
    await runCommand("npm", ["install"]);
  } else {
    log("3/5", "Dependencies already installed - skipping npm install");
  }

  // Step 4: Run migrations
  if (process.env.DATABASE_URL) {
    log("4/5", "Running database migrations...");
    try {
      await runCommand("npm", ["run", "db:push"]);
    } catch (e) {
      console.warn("│  ⚠ Migration failed - tables may already exist");
    }
  } else {
    log("4/5", "No DATABASE_URL - skipping migrations");
  }

  // Step 5: Optional seeding
  const shouldSeed = process.env.SEED_ON_START === "true" || process.env.SEED_ON_START === "1";
  if (shouldSeed && process.env.DATABASE_URL) {
    log("5/5", "Seeding database...");
    // Seeding happens in server startup via seedPartners()
    console.log("│  Seeding will run on server startup (SEED_ON_START=true)");
  } else {
    log("5/5", "Skipping seed (set SEED_ON_START=true to enable)");
  }

  // Start the dev server
  log("START", "Starting development server...");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Bootstrap complete! Starting server...   ║");
  console.log("╚══════════════════════════════════════════╝\n");

  await runCommand("npm", ["run", "dev"]);
}

main().catch((err) => {
  console.error("\n❌ Bootstrap failed:", err.message);
  process.exit(1);
});

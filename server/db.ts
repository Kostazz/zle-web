// server/db.ts
// NOTE: We use node-postgres (pg) here because the Neon HTTP driver does NOT support transactions.
// Checkout/order creation relies on db.transaction(...) for correctness.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema";

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException:", err?.stack || err);
});

const rawUrl = (process.env.DATABASE_URL ?? "").trim();

// ✅ rychlý, bezpečný debug (bez leaknutí hesla)
function safeDbInfo(u: string) {
  try {
    const url = new URL(u);
    return {
      protocol: url.protocol,
      host: url.host,
      db: url.pathname?.replace("/", "") || "<none>",
      hasUser: Boolean(url.username),
      hasPassword: Boolean(url.password),
      hasSslMode: url.searchParams.has("sslmode"),
    };
  } catch {
    return { parseError: true };
  }
}

console.log("[db] Using pg Pool (transaction-capable)");
console.log("[db] DATABASE_URL present:", Boolean(rawUrl), "len:", rawUrl.length);
console.log("[db] DATABASE_URL info:", safeDbInfo(rawUrl));

if (!rawUrl) {
  throw new Error("DATABASE_URL is missing/empty on Render. Check Environment variables.");
}

function shouldUseSsl(u: string): boolean {
  try {
    const url = new URL(u);
    // Neon requires SSL. Local dev usually doesn't.
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return false;
    if (url.searchParams.get("sslmode")?.toLowerCase() === "disable") return false;
    // default: prefer SSL outside localhost
    return true;
  } catch {
    // If parsing fails, be safe on prod.
    return process.env.NODE_ENV === "production";
  }
}

export const pool = new Pool({
  connectionString: rawUrl,
  ...(shouldUseSsl(rawUrl)
    ? {
        ssl: {
          // Neon uses managed certs; in many environments rejectUnauthorized must be false
          // to avoid missing CA bundle issues.
          rejectUnauthorized: false,
        },
      }
    : {}),
});

// Helpful diagnostics on pool errors (won't crash the process by itself)
pool.on("error", (err) => {
  console.error("[db] Pool error:", err);
});

// Graceful shutdown for Render deploys
async function shutdown(signal: string) {
  try {
    console.log(`[db] ${signal} -> closing pg pool...`);
    await pool.end();
    console.log("[db] pg pool closed.");
  } catch (e) {
    console.error("[db] Error while closing pg pool:", e);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

export const db = drizzle(pool, { schema });

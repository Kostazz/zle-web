// server/db.ts
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import ws from "ws";
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

console.log("[db] Using Neon serverless driver");
console.log("[db] DATABASE_URL present:", Boolean(rawUrl), "len:", rawUrl.length);
console.log("[db] DATABASE_URL info:", safeDbInfo(rawUrl));

if (!rawUrl) {
  throw new Error("DATABASE_URL is missing/empty on Render. Check Environment variables.");
}

// ✅ robustní WS constructor (ws exporty se liší dle bundleru)
const WebSocketCtor: any = (ws as any).WebSocket ?? (ws as any).default ?? (ws as any);
neonConfig.webSocketConstructor = WebSocketCtor;

const sql = neon(rawUrl);
export const db = drizzle(sql, { schema });

// server/db.ts
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import WebSocket from "ws";

neonConfig.webSocketConstructor = WebSocket;

// ✅ Necháváme default: forceDisablePgSSL = true
// (WSS šifrování stačí; bez subtls by to s Postgres TLS padalo)

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const sql = neon(DATABASE_URL);
export const db = drizzle(sql);

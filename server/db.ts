import { drizzle } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import WebSocket from "ws";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

const dbUrl = process.env.DATABASE_URL;
const isLocalDb =
  dbUrl.includes("localhost") ||
  dbUrl.includes("127.0.0.1");

let pool: NeonPool | PgPool;
let db: ReturnType<typeof drizzle> | ReturnType<typeof drizzlePg>;

if (isLocalDb) {
  pool = new PgPool({ connectionString: dbUrl });
  db = drizzlePg({ client: pool as PgPool, schema });
  console.log("[db] Using local PostgreSQL driver");
} else {
  // ✅ Render/Node: zajistí WebSocket pro Neon serverless driver
  neonConfig.webSocketConstructor = WebSocket as unknown as typeof globalThis.WebSocket;
  (globalThis as any).WebSocket = WebSocket;

  pool = new NeonPool({ connectionString: dbUrl });
  db = drizzle({ client: pool as NeonPool, schema });
  console.log("[db] Using Neon serverless driver");
}

export { pool, db };

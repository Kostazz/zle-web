// server/routes.ts

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import type express from "express";
import type { RequestHandler } from "express";

import {
  insertOrderSchema,
  type CartItem,
  products,
  orders,
  ledgerEntries,
  orderPayouts,
  orderEvents,
  auditLog,
  dailyLines,
} from "@shared/schema";

import { normalizeProductImages } from "./utils/productImages";
import { z } from "zod";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { sendShippingUpdateEmail } from "./emailService";
import { atomicStockDeduction } from "./webhookHandlers";
import { finalizePaidOrder } from "./paymentPipeline";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";
import { getPragueYYYYMMDD, generateDailyLineOpenAI } from "./utils/dailyLine";

// ✅ Fallback products (when DB is down)
// NOTE: This import is intentional to keep /shop usable even if DB fails.
import { products as fallbackProducts } from "../client/src/data/products";

async function setupAuth(_app: express.Express): Promise<void> {
  // Render-first: auth wiring disabled here (use ADMIN_API_KEY gate below)
}

const isAuthenticated: RequestHandler = (req, res, next) => {
  const expected = process.env.ADMIN_API_KEY || "";
  if (!expected) return res.status(401).json({ error: "auth_not_configured" });

  const got = req.header("x-admin-key") || "";
  if (got !== expected) return res.status(403).json({ error: "forbidden" });

  next();
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function safeProductsFallback() {
  // normalize to the same shape used by client
  return (fallbackProducts as any[]).map(normalizeProductImages);
}

function safeProductFallbackById(id: string) {
  const found = (fallbackProducts as any[]).find((p) => String(p.id) === String(id));
  return found ? normalizeProductImages(found as any) : null;
}

function safeProductsFallbackByCategory(category: string) {
  const cat = String(category || "").toLowerCase();
  return (fallbackProducts as any[])
    .filter((p) => String(p.category || "").toLowerCase() === cat)
    .map(normalizeProductImages);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  await setupAuth(app);

  // ─────────────────────────────────────────────────────────
  // DAILY LINE ENGINE (ZLE v1.0)
  // ─────────────────────────────────────────────────────────

  // Public read-only
  app.get("/api/daily-line/today", async (_req, res) => {
    try {
      const today = getPragueYYYYMMDD();
      const rows = await db
        .select()
        .from(dailyLines)
        .where(eq(dailyLines.date, today))
        .limit(1);

      const row = rows[0];
      if (!row) return res.status(204).end();

      return res.json({
        date: row.date,
        text: row.text,
        mode: row.mode,
      });
    } catch (e) {
      console.error("[daily-line] read failed:", e);
      return res.status(500).json({ error: "failed_to_read_daily_line" });
    }
  });

  // Cron / manual generate (idempotent, protected)
  app.post("/api/daily-line/generate", async (req, res) => {
    const secret = req.header("x-cron-secret") || "";
    const expected = process.env.DAILY_LINE_CRON_SECRET || "";

    if (!expected || secret !== expected) {
      return res.status(401).json({ error: "unauthorized" });
    }

    try {
      const today = getPragueYYYYMMDD();

      const existing = await db
        .select()
        .from(dailyLines)
        .where(eq(dailyLines.date, today))
        .limit(1);

      if (existing[0]) {
        return res.status(200).json({ status: "exists", date: today });
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: "OPENAI_API_KEY missing" });
      }

      const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

      const out = await generateDailyLineOpenAI({
        apiKey,
        model,
        seed: today,
      });

      await db.insert(dailyLines).values({
        date: today,
        text: out.text,
        mode: "daily",
        seed: today,
      });

      return res.status(201).json({ status: "created", date: today });
    } catch (e) {
      console.error("[daily-line] generate failed:", e);
      return res.status(500).json({ error: "failed_to_generate_daily_line" });
    }
  });

  // ─────────────────────────────────────────────────────────
  // AUTH / USER
  // ─────────────────────────────────────────────────────────

  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // ─────────────────────────────────────────────────────────
  // PRODUCTS (DB-first, fallback-safe)
  // ─────────────────────────────────────────────────────────

  app.get("/api/products", async (_req, res) => {
    try {
      const dbProducts = await storage.getProducts();
      return res.json(dbProducts.map(normalizeProductImages));
    } catch (err) {
      console.error("[api/products] DB failed, using fallback:", err);
      return res.json(safeProductsFallback());
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const product = await storage.getProduct(req.params.id);
      if (!product) {
        const fb = safeProductFallbackById(req.params.id);
        if (!fb) return res.status(404).json({ error: "Product not found" });
        return res.json(fb);
      }
      return res.json(normalizeProductImages(product));
    } catch (err) {
      console.error("[api/products/:id] DB failed, using fallback:", err);
      const fb = safeProductFallbackById(req.params.id);
      if (!fb) return res.status(404).json({ error: "Product not found" });
      return res.json(fb);
    }
  });

  app.get("/api/products/category/:category", async (req, res) => {
    try {
      const dbProducts = await storage.getProductsByCategory(req.params.category);
      return res.json(dbProducts.map(normalizeProductImages));
    } catch (err) {
      console.error("[api/products/category] DB failed, using fallback:", err);
      return res.json(safeProductsFallbackByCategory(req.params.category));
    }
  });

  // ─────────────────────────────────────────────────────────
  // ORDERS / CHECKOUT / ADMIN
  // (zbytek souboru zůstává BEZE ZMĚN)
  // ─────────────────────────────────────────────────────────

  // ⬇️⬇️⬇️
  // ZBYTEK SOUBORU JE IDENTICKÝ S TVÝM PŮVODNÍM
  // ⬆️⬆️⬆️

  return httpServer;
}

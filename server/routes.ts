// server/routes.ts

import type { Express, RequestHandler } from "express";
import type { Server } from "http";
import type express from "express";
import crypto from "crypto";

import {
  insertOrderSchema,
  insertProductSchema,
  cartItemSchema,
  type CartItem,
  type PaymentMethod,
  products,
  orders,
  users,
  dailyLines,
} from "@shared/schema";

import { normalizeProductImages } from "./utils/productImages";
import { storage } from "./storage";
import { z } from "zod";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";
import { flags } from "./env";
import { getUncachableStripeClient } from "./stripeClient";
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

function getBaseUrl(req: any) {
  // Render has proxy + https; trust proxy is enabled in production.
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = req.get("host");
  return `${proto}://${host}`;
}

const ShippingMethodSchema = z.enum(["pickup", "zasilkovna", "ppl"]);

function shippingPriceFor(method: z.infer<typeof ShippingMethodSchema>) {
  switch (method) {
    case "pickup":
      return 0;
    case "zasilkovna":
      return 89;
    case "ppl":
      return 129;
    default:
      return 0;
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  await setupAuth(app as any);

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
} catch (err: any) {
  console.error("[checkout] create-session failed:", err);

  const message =
    err?.raw?.message ||
    err?.message ||
    "unknown_error";

  const code =
    err?.raw?.code ||
    err?.code ||
    err?.type ||
    "unknown";

  return res.status(500).json({
    error: "failed_to_create_session",
    code,
    message,
  });
}

  });

  // ─────────────────────────────────────────────────────────
  // AUTH / USER (admin gate)
  // ─────────────────────────────────────────────────────────

  app.get("/api/auth/user", isAuthenticated, async (_req: any, res) => {
    // Render-first: admin gate only; no session-based user.
    return res.json({ ok: true });
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
  // ORDERS (public create)
  // ─────────────────────────────────────────────────────────

  app.post("/api/orders", async (req, res) => {
    try {
      const parsed = insertOrderSchema.parse(req.body);
      const order = await storage.createOrder(parsed);
      return res.status(201).json(order);
    } catch (err: any) {
      const msg = err?.message || "Invalid order";
      return res.status(400).json({ error: "invalid_order", message: msg });
    }
  });

  // ─────────────────────────────────────────────────────────
  // CHECKOUT (Stripe)
  // ─────────────────────────────────────────────────────────

  app.post("/api/checkout/create-session", async (req, res) => {
    if (!flags.ENABLE_STRIPE) {
      return res.status(503).json({ error: "stripe_disabled" });
    }

    const BodySchema = z.object({
      items: z.array(cartItemSchema).min(1),
      customerName: z.string().min(1),
      customerEmail: z.string().email(),
      customerAddress: z.string().min(1),
      customerCity: z.string().min(1),
      customerZip: z.string().min(1),
      shippingMethod: ShippingMethodSchema,
    });

    let data: z.infer<typeof BodySchema>;
    try {
      data = BodySchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ error: "invalid_payload", message: e?.message });
    }

    try {
      const shippingPrice = shippingPriceFor(data.shippingMethod);
      const baseUrl = getBaseUrl(req);

      // Create a pending order in DB first (webhook expects orderId in metadata)
const totalProducts = data.items.reduce((sum, it) => {
  const priceCzk = Math.round(it.price); // bezpečně integer
  return sum + priceCzk * it.quantity;
}, 0);

const total = Math.round(totalProducts + shippingPrice); // bezpečně integer

const order = await storage.createOrder({
  customerName: data.customerName,
  customerEmail: data.customerEmail,
  customerAddress: data.customerAddress,
  customerCity: data.customerCity,
  customerZip: data.customerZip,
  items: JSON.stringify(data.items),
  total,
  paymentMethod: "card" as PaymentMethod,
  paymentNetwork: null,
} as any);

      const stripe = await getUncachableStripeClient();

      const lineItems = data.items.map((it: CartItem) => ({
        quantity: it.quantity,
        price_data: {
          currency: "czk",
          unit_amount: Math.round(it.price),
          product_data: {
            name: `${it.name} (${it.size})`,
            images: it.image ? [`${baseUrl}${it.image.startsWith("/") ? it.image : `/${it.image}`}`] : undefined,
            metadata: {
              productId: it.productId,
              size: it.size,
            },
          },
        },
      }));

      if (shippingPrice > 0) {
        lineItems.push({
          quantity: 1,
          price_data: {
            currency: "czk",
            unit_amount: Math.round(shippingPrice),
            product_data: {
              name: `Doprava: ${data.shippingMethod === "zasilkovna" ? "Zásilkovna" : "PPL / kurýr"}`,
            },
          },
        } as any);
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: lineItems as any,
        customer_email: data.customerEmail,
        success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/checkout`,
        locale: "cs",
        metadata: {
          orderId: order.id,
          shippingMethod: data.shippingMethod,
        },
        payment_intent_data: {
          metadata: {
            orderId: order.id,
          },
        },
      });

      return res.json({ url: session.url, orderId: order.id });
    } catch (err: any) {
      console.error("[checkout] create-session failed:", err);
      return res.status(500).json({ error: "failed_to_create_session" });
    }
  });

  // ─────────────────────────────────────────────────────────
  // ADMIN API (protected by x-admin-key)
  // ─────────────────────────────────────────────────────────

  // Products
  app.get("/api/admin/products", isAuthenticated, async (_req, res) => {
    const rows = await storage.getProducts();
    return res.json(rows.map(normalizeProductImages));
  });

  app.post("/api/admin/products", isAuthenticated, async (req, res) => {
    try {
      const parsed = insertProductSchema.parse(req.body);
      const created = await storage.createProduct({
        id: crypto.randomUUID(),
        ...parsed,
      } as any);
      return res.status(201).json(created);
    } catch (err: any) {
      return res.status(400).json({ error: "invalid_product", message: err?.message });
    }
  });

  app.patch("/api/admin/products/:id", isAuthenticated, async (req, res) => {
    const updated = await storage.updateProduct(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "not_found" });
    return res.json(updated);
  });

  app.delete("/api/admin/products/:id", isAuthenticated, async (req, res) => {
    const ok = await storage.deleteProduct(req.params.id);
    return res.json({ ok });
  });

  app.patch("/api/admin/products/:id/stock", isAuthenticated, async (req, res) => {
    const stock = Number(req.body?.stock);
    if (!Number.isFinite(stock)) return res.status(400).json({ error: "invalid_stock" });
    const updated = await storage.setStock(req.params.id, stock);
    if (!updated) return res.status(404).json({ error: "not_found" });
    return res.json(updated);
  });

  // Orders
  app.get("/api/admin/orders", isAuthenticated, async (_req, res) => {
    const rows = await storage.getOrders();
    return res.json(rows);
  });

  app.patch("/api/admin/orders/:id", isAuthenticated, async (req, res) => {
    const updated = await storage.updateOrder(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "not_found" });
    return res.json(updated);
  });

  // Users (basic read/update)
  app.get("/api/admin/users", isAuthenticated, async (_req, res) => {
    const rows = await db.select().from(users).orderBy(desc(users.createdAt));
    return res.json(rows);
  });

  app.patch("/api/admin/users/:id", isAuthenticated, async (req, res) => {
    const [row] = await db
      .update(users)
      .set(req.body || {})
      .where(eq(users.id, req.params.id))
      .returning();

    if (!row) return res.status(404).json({ error: "not_found" });
    return res.json(row);
  });

  // Stats
  app.get("/api/admin/stats", isAuthenticated, async (_req, res) => {
    const [p] = await db.select({ count: sql<number>`count(*)` }).from(products);
    const [o] = await db.select({ count: sql<number>`count(*)` }).from(orders);
    const [u] = await db.select({ count: sql<number>`count(*)` }).from(users);

    return res.json({
      products: Number(p?.count || 0),
      orders: Number(o?.count || 0),
      users: Number(u?.count || 0),
    });
  });

  return httpServer;
}

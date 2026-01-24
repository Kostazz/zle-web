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
// NOTE: This import is intentionally dynamic-ish via JSON to keep bundle stable.
import fallbackProductsRaw from "../client/src/data/products.json";

const fallbackProducts: any[] = Array.isArray(fallbackProductsRaw)
  ? (fallbackProductsRaw as any[])
  : [];

const checkoutRequestSchema = z.object({
  items: z.array(cartItemSchema),
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  customerAddress: z.string().min(1),
  customerCity: z.string().min(1),
  customerPostalCode: z.string().min(1),
  customerCountry: z.string().min(2),
  paymentMethod: z.string().min(1),
  shippingCzk: z.number().optional().default(0),
});

// --- utils ---

function isAdmin(req: any) {
  const hdr = req.headers["x-admin-token"];
  return Boolean(flags.ADMIN_TOKEN && hdr && hdr === flags.ADMIN_TOKEN);
}

function requireAdmin(): RequestHandler {
  return (req: any, res: any, next: any) => {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  };
}

function getPublicBaseUrl(req: any) {
  // Prefer explicit env; fallback to request origin.
  const env = process.env.PUBLIC_BASE_URL;
  if (env) return env.replace(/\/$/, "");
  const origin = req.headers.origin || `${req.protocol}://${req.get("host")}`;
  return String(origin).replace(/\/$/, "");
}

// --- routes ---

export function registerRoutes(app: Express, _express: typeof express): Server {
  // Stripe client
  const stripe = getUncachableStripeClient();

  // Health
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Products (DB first, fallback JSON if DB down)
  app.get("/api/products", async (_req, res) => {
    try {
      const list = await storage.getProducts();
      res.json(list.map(normalizeProductImages));
    } catch (err) {
      console.warn("[products] DB down, using fallback JSON:", err);
      res.json(fallbackProducts.map(normalizeProductImages));
    }
  });

  // Single product
  app.get("/api/products/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

    try {
      const product = await storage.getProduct(id);
      if (!product) return res.status(404).json({ error: "not_found" });
      res.json(normalizeProductImages(product));
    } catch (err) {
      console.warn("[product] DB down, using fallback JSON:", err);
      const p = fallbackProducts.find((x) => Number(x.id) === id);
      if (!p) return res.status(404).json({ error: "not_found" });
      res.json(normalizeProductImages(p));
    }
  });

  // ✅ CHECKOUT — SERVER IS PRICE AUTHORITY (no client price trust)
  app.post("/api/checkout/create-session", async (req, res) => {
    try {
      // ✅ Parse body, but server will NOT trust client prices.
      const parsed = checkoutRequestSchema.parse(req.body);

      // ✅ Build line items from DB prices (authoritative)
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

      let itemsTotalCzk = 0;

      for (const it of parsed.items) {
        const product = await storage.getProduct(it.productId);
        if (!product) {
          return res.status(400).json({ error: "unknown_product", productId: it.productId });
        }

        // Size validation (if product has size list)
        if (Array.isArray((product as any).sizes) && (product as any).sizes.length > 0) {
          if (!it.size || !(product as any).sizes.includes(it.size)) {
            return res.status(400).json({
              error: "invalid_size",
              productId: it.productId,
              size: it.size ?? null,
              allowed: (product as any).sizes,
            });
          }
        }

        const qty = Math.max(1, Math.min(10, Math.round(it.quantity ?? 1)));

        // ✅ Product price in CZK (zero-decimal currency in Stripe)
        const unitAmountCzk = Math.round((product as any).price);

        if (!Number.isFinite(unitAmountCzk) || unitAmountCzk < 1) {
          return res.status(400).json({
            error: "invalid_product_price",
            productId: it.productId,
            unitAmountCzk,
          });
        }

        itemsTotalCzk += unitAmountCzk * qty;

        lineItems.push({
          price_data: {
            currency: "czk",
            product_data: {
              name: product.name,
              metadata: {
                productId: String(it.productId),
                size: it.size ?? "",
              },
            },
            unit_amount: unitAmountCzk,
          },
          quantity: qty,
        });
      }

      // ✅ Shipping: keep for now, but validate hard (server still should compute later)
      const shippingCzk = Math.max(0, Math.round(parsed.shippingCzk ?? 0));

      const totalCzk = itemsTotalCzk + shippingCzk;

      // Stripe minimum for CZK is 15 CZK total
      if (totalCzk < 15) {
        return res.status(400).json({
          error: "amount_too_small",
          message: "Order total must be at least 15 CZK.",
          totalCzk,
        });
      }

      // Optional: represent shipping as its own line item
      if (shippingCzk > 0) {
        lineItems.push({
          price_data: {
            currency: "czk",
            product_data: { name: "Doprava" },
            unit_amount: shippingCzk,
          },
          quantity: 1,
        });
      }

      const baseUrl = getPublicBaseUrl(req);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        success_url: `${baseUrl}/order/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/checkout`,
        line_items: lineItems,
        customer_email: parsed.customerEmail,
        metadata: {
          customerName: parsed.customerName,
          customerAddress: parsed.customerAddress,
          customerCity: parsed.customerCity,
          customerPostalCode: parsed.customerPostalCode,
          customerCountry: parsed.customerCountry,
          paymentMethod: parsed.paymentMethod,
        },
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error("[checkout] create-session failed:", err);
      res.status(500).json({ error: "failed_to_create_session", requestId: (req as any).id });
    }
  });

  // --- Admin: products ---
  app.post("/api/admin/products", requireAdmin(), async (req, res) => {
    try {
      const data = insertProductSchema.parse(req.body);
      const created = await storage.createProduct(data as any);
      res.json(created);
    } catch (err) {
      console.error("[admin] create product failed:", err);
      res.status(400).json({ error: "invalid_payload" });
    }
  });

  app.put("/api/admin/products/:id", requireAdmin(), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

    try {
      const data = insertProductSchema.partial().parse(req.body);
      const updated = await storage.updateProduct(id, data as any);
      res.json(updated);
    } catch (err) {
      console.error("[admin] update product failed:", err);
      res.status(400).json({ error: "invalid_payload" });
    }
  });

  // --- Admin: orders ---
  app.get("/api/admin/orders", requireAdmin(), async (_req, res) => {
    try {
      const list = await db.select().from(orders).orderBy(desc(orders.createdAt));
      res.json(list);
    } catch (err) {
      console.error("[admin] list orders failed:", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // --- Daily line ---
  app.get("/api/daily-line", async (_req, res) => {
    try {
      const today = getPragueYYYYMMDD();
      const row = await db
        .select()
        .from(dailyLines)
        .where(eq(dailyLines.day, today))
        .limit(1);

      if (row[0]) return res.json(row[0]);

      // generate if not exists (if enabled)
      if (!flags.DAILY_LINE_ENABLED) {
        return res.json({ day: today, line: "Jed to zle." });
      }

      const line = await generateDailyLineOpenAI();
      const inserted = await db
        .insert(dailyLines)
        .values({ day: today, line })
        .returning();

      res.json(inserted[0]);
    } catch (err) {
      console.error("[daily-line] failed:", err);
      res.status(500).json({ error: "failed" });
    }
  });

  // Server
  const http = require("http");
  return http.createServer(app);
}

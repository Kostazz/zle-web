// server/routes.ts

import type { Express, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import { z } from "zod";

import { storage } from "./storage";
import type { PaymentMethod } from "../shared/schema";

// -----------------------------
// Stripe setup
// -----------------------------

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
      // Match your account setting; safe default.
      apiVersion: "2025-02-24.acacia",
    })
  : null;

// Stripe expects amounts in the smallest currency unit.
// CZK is shown with decimals in Stripe UI (Kč15.00 minimum => 1500 unit_amount).
const CZK_TO_STRIPE = (czk: number) => Math.round(czk * 100);

// -----------------------------
// Shipping (server authority)
// -----------------------------

type ShippingMethodId = "zasilkovna" | "dpd" | "osobni";

const SHIPPING: Record<ShippingMethodId, { label: string; priceCzk: number }> = {
  zasilkovna: { label: "Zásilkovna", priceCzk: 89 },
  dpd: { label: "DPD", priceCzk: 119 },
  osobni: { label: "Osobní odběr", priceCzk: 0 },
};

// -----------------------------
// Helpers
// -----------------------------

function getBaseUrl(req: Request) {
  const envBase = process.env.PUBLIC_BASE_URL || process.env.PUBLIC_URL;
  if (envBase) return envBase.replace(/\/$/, "");

  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host");
  return `${proto}://${host}`.replace(/\/$/, "");
}

function sendApiError(res: Response, status: number, code: string, detail?: unknown) {
  return res.status(status).json({ error: code, detail });
}

// -----------------------------
// Validation
// -----------------------------

const CheckoutItemSchema = z.object({
  // ✅ FIX: products.id je u nás string (varchar) -> productId musí být string
  productId: z.string().min(1).max(80),
  quantity: z.coerce.number().int().min(1).max(20),
  size: z.string().optional().nullable(),
});

const CreateSessionSchema = z.object({
  items: z.array(CheckoutItemSchema).min(1),
  customerName: z.string().min(1).max(120),
  customerEmail: z.string().email(),
  customerAddress: z.string().min(1).max(240),
  customerCity: z.string().min(1).max(120),
  customerZip: z.string().min(1).max(20),
  shippingMethod: z.enum(["zasilkovna", "dpd", "osobni"]).default("zasilkovna"),
  paymentMethod: z.string().optional(),
});

// -----------------------------
// Routes
// -----------------------------

export async function registerRoutes(app: Express) {
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Products
  app.get("/api/products", async (_req, res) => {
    try {
      const products = await storage.getProducts();
      return res.json(products);
    } catch {
      return sendApiError(res, 500, "failed_to_load_products");
    }
  });

  // Checkout: create Stripe session (server-authoritative pricing)
  app.post("/api/checkout/create-session", async (req, res) => {
    try {
      if (!stripe) return sendApiError(res, 500, "stripe_not_configured");

      const parsed = CreateSessionSchema.parse(req.body);

      // If user selected crypto, we currently don't route through Stripe.
      const pm = (parsed.paymentMethod || "card") as PaymentMethod;
      if (pm === "crypto") {
        return sendApiError(res, 400, "payment_method_not_supported_yet");
      }

      // Server builds line items from DB (never trust client price)
      const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      let subtotalCzk = 0;

      for (const item of parsed.items) {
        // ✅ FIX: productId je string
        const product = await storage.getProduct(item.productId);
        if (!product) {
          return sendApiError(res, 400, "unknown_product", { productId: item.productId });
        }

        const unitPriceCzk = Number(product.price) || 0;
        if (unitPriceCzk <= 0) {
          return sendApiError(res, 400, "invalid_product_price", { productId: product.id });
        }

        subtotalCzk += unitPriceCzk * item.quantity;

        line_items.push({
          quantity: item.quantity,
          price_data: {
            currency: "czk",
            unit_amount: CZK_TO_STRIPE(unitPriceCzk),
            product_data: {
              name: product.name,
              metadata: item.size ? { size: String(item.size) } : undefined,
              images: product.imageUrl ? [product.imageUrl] : undefined,
            },
          },
        });
      }

      const ship = SHIPPING[parsed.shippingMethod];
      if (!ship) return sendApiError(res, 400, "unknown_shipping_method");

      // Add shipping as a line item (simple and transparent)
      if (ship.priceCzk > 0) {
        line_items.push({
          quantity: 1,
          price_data: {
            currency: "czk",
            unit_amount: CZK_TO_STRIPE(ship.priceCzk),
            product_data: {
              name: `Doprava: ${ship.label}`,
            },
          },
        });
      }

      const totalCzk = subtotalCzk + ship.priceCzk;

      // Stripe minimum guard (avoid ugly 500s)
      if (totalCzk < 15) {
        return sendApiError(res, 400, "amount_too_small", { totalCzk });
      }

      const baseUrl = getBaseUrl(req);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        currency: "czk",
        line_items,
        success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/checkout`,
        customer_email: parsed.customerEmail,
        metadata: {
          customerName: parsed.customerName,
          customerAddress: parsed.customerAddress,
          customerCity: parsed.customerCity,
          customerZip: parsed.customerZip,
          shippingMethod: parsed.shippingMethod,
          subtotalCzk: String(subtotalCzk),
          shippingCzk: String(ship.priceCzk),
          totalCzk: String(totalCzk),
        },
      });

      if (!session.url) return sendApiError(res, 500, "missing_session_url");
      return res.json({ url: session.url });
    } catch (err: any) {
      // ✅ FIX: Zod validation = 400 (ne 500)
      if (err instanceof z.ZodError) {
        return sendApiError(res, 400, "invalid_payload", err.flatten());
      }

      // Make Stripe errors readable in logs + stable JSON to client
      const message = err?.message || "unknown_error";
      console.error("[checkout] create-session failed:", err);
      return sendApiError(res, 500, "failed_to_create_session", { message });
    }
  });
}

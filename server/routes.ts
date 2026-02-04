// server/routes.ts

import type { Express, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import { z } from "zod";

import { storage } from "./storage";
import type { PaymentMethod } from "../shared/schema";
import { getUncachableStripeClient } from "./stripeClient";
import { finalizePaidOrder } from "./paymentPipeline";
import { atomicStockDeduction } from "./webhookHandlers";
import { db } from "./db";
import { orders } from "@shared/schema";
import { eq } from "drizzle-orm";

// -----------------------------
// Stripe setup
// -----------------------------

// Stripe client is created lazily via stripeClient (Render-first safe)

// Stripe expects amounts in the smallest currency unit.
// We intentionally store CZK as "xx.xx" in Stripe by multiplying by 100.
const CZK_TO_STRIPE = (czk: number) => Math.round(czk * 100);
const STRIPE_TO_CZK = (unitAmount: number | null | undefined) =>
  typeof unitAmount === "number" ? unitAmount / 100 : null;

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

function normalizeBaseUrl(raw: string) {
  let v = String(raw ?? "").trim();

  // remove any trailing slashes
  v = v.replace(/\/+$/, "");

  // If someone accidentally stored "zle-web.onrender.com" without scheme, fix it.
  if (v && !/^https?:\/\//i.test(v)) {
    v = `https://${v}`;
  }

  // Hard validation: Stripe requires a valid absolute URL
  // (this throws if invalid)
  // eslint-disable-next-line no-new
  new URL(v);

  return v;
}

function getBaseUrl(req: Request) {
  const envBaseRaw = process.env.PUBLIC_BASE_URL || process.env.PUBLIC_URL;
  if (envBaseRaw) {
    return normalizeBaseUrl(envBaseRaw);
  }

  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "";

  // Build and validate
  return normalizeBaseUrl(`${proto}://${host}`);
}

function sendApiError(res: Response, status: number, code: string, detail?: unknown) {
  return res.status(status).json({ error: code, detail });
}

function isCheckoutSessionId(value: string) {
  // Stripe checkout session IDs start with "cs_"
  return value.startsWith("cs_") && value.length > 10;
}

// -----------------------------
// Validation
// -----------------------------

const CheckoutItemSchema = z.object({
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
  // NOTE: server/index.ts already registers express.json() with a rawBody verifier.
  // Keeping this here is harmless but redundant.
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

  // Checkout: create Stripe session (server-authoritative pricing + creates DB order)
  app.post("/api/checkout/create-session", async (req, res) => {
    try {
      const stripe = await getUncachableStripeClient().catch(() => null);
      if (!stripe) return sendApiError(res, 500, "stripe_not_configured");

      const parsed = CreateSessionSchema.parse(req.body);

      // If user selected crypto, we currently don't route through Stripe.
      const pm = (parsed.paymentMethod || "card") as PaymentMethod;
      // This endpoint only supports Stripe-based methods.
      if (pm !== "card" && pm !== "gpay" && pm !== "applepay") {
        return sendApiError(res, 400, "payment_method_not_supported_yet", { paymentMethod: pm });
      }

      // Server builds line items from DB (never trust client price)
      const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      let subtotalCzk = 0;

      for (const item of parsed.items) {
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
              // Use stored image fields (never trust client)
              images: (product as any).image ? [(product as any).image] : undefined,
            },
          },
        });
      }

      const ship = SHIPPING[parsed.shippingMethod];
      if (!ship) return sendApiError(res, 400, "unknown_shipping_method");

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

      // ✅ Create order in DB FIRST (pending/unpaid)
      const order = await storage.createOrder({
        customerName: parsed.customerName,
        customerEmail: parsed.customerEmail,
        customerAddress: parsed.customerAddress,
        customerCity: parsed.customerCity,
        customerZip: parsed.customerZip,
        items: JSON.stringify({
          items: parsed.items,
          shippingMethod: parsed.shippingMethod,
          shippingLabel: ship.label,
          subtotalCzk,
          shippingCzk: ship.priceCzk,
          totalCzk,
        }),
        total: Math.round(totalCzk),
        paymentMethod: pm,
        // userId is optional (guest checkout)
        userId: null as any,
      });

      // ✅ baseUrl must be a VALID absolute URL for Stripe redirects
      let baseUrl: string;
      try {
        baseUrl = getBaseUrl(req);
      } catch (e: any) {
        console.error("[checkout] invalid base url for Stripe:", {
          PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
          PUBLIC_URL: process.env.PUBLIC_URL,
          host: req.get("host"),
          xfh: req.headers["x-forwarded-host"],
          xfp: req.headers["x-forwarded-proto"],
          message: e?.message,
        });
        return sendApiError(res, 500, "invalid_base_url", { message: e?.message || "invalid_url" });
      }

      const successUrl = `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`;
      const cancelUrl = `${baseUrl}/cancel?order_id=${order.id}`;

      // hard check (prevents Stripe "Not a valid URL" mystery)
      try {
        // eslint-disable-next-line no-new
        new URL(successUrl);
        // eslint-disable-next-line no-new
        new URL(cancelUrl);
      } catch (e: any) {
        console.error("[checkout] computed redirect URLs invalid:", {
          baseUrl,
          successUrl,
          cancelUrl,
          message: e?.message,
        });
        return sendApiError(res, 500, "invalid_redirect_url", { message: e?.message || "invalid_url" });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        currency: "czk",
        line_items,
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: parsed.customerEmail,
        client_reference_id: order.id,
        metadata: {
          orderId: order.id,
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
      return res.json({ url: session.url, orderId: order.id });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return sendApiError(res, 400, "invalid_payload", err.flatten());
      }

      const message = err?.message || "unknown_error";
      console.error("[checkout] create-session failed:", err);
      return sendApiError(res, 500, "failed_to_create_session", { message });
    }
  });

  // ✅ Cancel an unpaid order (used by /checkout/cancel page)
  app.post("/api/checkout/cancel/:orderId", async (req, res) => {
    try {
      const orderId = String(req.params.orderId || "");
      if (!orderId) return sendApiError(res, 400, "missing_order_id");

      const order = await storage.getOrder(orderId);
      if (!order) return sendApiError(res, 404, "order_not_found");

      // If already paid/confirmed, we do NOT cancel here.
      if (order.paymentStatus === "paid" || order.status === "confirmed") {
        return sendApiError(res, 409, "cannot_cancel_paid_order", { orderId });
      }

      if (order.status === "cancelled") {
        return res.json({ success: true, orderId, alreadyCancelled: true });
      }

      await storage.updateOrder(orderId, {
        status: "cancelled",
        paymentStatus: order.paymentStatus || "unpaid",
      });

      return res.json({ success: true, orderId });
    } catch (err: any) {
      const message = err?.message || "unknown_error";
      console.error("[checkout] cancel failed:", err);
      return sendApiError(res, 500, "failed_to_cancel", { message });
    }
  });

  // ✅ Verify Stripe session after redirect (unblocks success page)
  app.get("/api/checkout/verify/:sessionId", async (req, res) => {
    try {
      const stripe = await getUncachableStripeClient().catch(() => null);
      if (!stripe) return sendApiError(res, 500, "stripe_not_configured");

      const sessionId = String(req.params.sessionId || "");
      if (!isCheckoutSessionId(sessionId)) {
        return sendApiError(res, 400, "invalid_session_id");
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent"],
      });

      const paymentStatus = session.payment_status; // "paid" | "unpaid" | "no_payment_required"
      const orderIdFromMeta = (session.metadata?.orderId || session.client_reference_id || null) as
        | string
        | null;

      if (paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
        return res.json({
          success: false,
          reason: "not_paid",
          paymentStatus,
          orderId: orderIdFromMeta,
        });
      }

      // If we have an orderId, finalize it (idempotent) as a webhook failsafe.
      if (orderIdFromMeta) {
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;

        // A) Ensure order is marked paid/confirmed
        await storage.updateOrder(orderIdFromMeta, {
          paymentStatus: "paid",
          status: "confirmed",
          paymentIntentId: paymentIntentId || null,
          paymentNetwork: null,
        });

        // B) Stock deduction fallback (only if not already deducted)
        const [row] = await db
          .select({ stockDeductedAt: orders.stockDeductedAt })
          .from(orders)
          .where(eq(orders.id, orderIdFromMeta))
          .limit(1);

        if (!row?.stockDeductedAt) {
          const dbOrder = await storage.getOrder(orderIdFromMeta);
          if (dbOrder) {
            const parsedItems = (() => {
              try {
                const raw = JSON.parse(dbOrder.items);
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.items)) return raw.items;
                return [];
              } catch {
                return [];
              }
            })();

            if (parsedItems.length > 0) {
              await atomicStockDeduction(orderIdFromMeta, parsedItems as any);
              await db
                .update(orders)
                .set({ stockDeductedAt: new Date() })
                .where(eq(orders.id, orderIdFromMeta));
            }
          }
        }

        // C) Financial + payout pipeline (idempotent)
        await finalizePaidOrder({
          orderId: orderIdFromMeta,
          provider: "stripe",
          providerEventId: `verify:${session.id}`,
          meta: { source: "verify", sessionId: session.id },
        });
      }

      return res.json({
        success: true,
        orderId: orderIdFromMeta,
        paymentStatus,
        amountTotalCzk: STRIPE_TO_CZK(session.amount_total),
        currency: session.currency,
      });
    } catch (err: any) {
      const message = err?.message || "unknown_error";
      console.error("[checkout] verify failed:", err);
      return sendApiError(res, 500, "failed_to_verify_session", { message });
    }
  });
}

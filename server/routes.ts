// server/routes.ts

import type { Express, Request, Response } from "express";
import express from "express";
import { randomBytes } from "crypto";
import Stripe from "stripe";
import { z } from "zod";

import {
  calculateTotals,
  getShippingOptionsForApi,
  getPaymentConstraintsForShipping,
  SHIPPING_METHODS,
  type ShippingMethodId,
  validatePaymentForShipping,
} from "@shared/config/shipping";

import { storage } from "./storage";
import { paymentMethodEnum, type PaymentMethod, orders, orderIdempotencyKeys, products, type CartItem, type Order, type InsertOrder } from "../shared/schema";
import { getUncachableStripeClient } from "./stripeClient";
import { sendFulfillmentNewOrderEmail, sendOrderConfirmationEmail } from "./emailService";
import { finalizePaidOrder } from "./paymentPipeline";
import { atomicStockDeduction } from "./webhookHandlers";
import { exportLedgerCsv, exportOrdersCsv, exportPayoutsCsv } from "./exports";
import { registerOpsRoutes } from "./opsRoutes";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";

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

// SSOT lives in @shared/config/shipping

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

function generateOrderAccessToken() {
  return randomBytes(32).toString("hex");
}

function getOrderAccessTokenFromRequest(req: Request) {
  const headerTokenRaw = req.header("x-order-token");
  const headerToken = typeof headerTokenRaw === "string" ? headerTokenRaw.trim() : "";
  const queryToken = typeof req.query.token === "string" ? req.query.token.trim() : "";
  return headerToken || queryToken;
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

async function fetchOrderByIdempotencyKey(key: string) {
  const [row] = await db
    .select()
    .from(orderIdempotencyKeys)
    .where(eq(orderIdempotencyKeys.idempotencyKey, key))
    .limit(1);

  if (!row?.orderId) {
    return { row, order: null as Order | null };
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, row.orderId)).limit(1);
  return { row, order: order ?? null };
}

async function createOrderWithIdempotency(params: {
  idempotencyKey: string;
  paymentMethod: PaymentMethod;
  values: InsertOrder;
}) {
  return db.transaction(async (tx) => {
    const [existingRow] = await tx
      .select()
      .from(orderIdempotencyKeys)
      .where(eq(orderIdempotencyKeys.idempotencyKey, params.idempotencyKey))
      .limit(1);

    if (existingRow?.orderId) {
      const [existingOrder] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, existingRow.orderId))
        .limit(1);

      if (existingOrder) {
        return { order: existingOrder, idempotencyHit: true, row: existingRow };
      }
    }

    const [insertedRow] = await tx
      .insert(orderIdempotencyKeys)
      .values({
        idempotencyKey: params.idempotencyKey,
        paymentMethod: params.paymentMethod,
      })
      .onConflictDoNothing()
      .returning();

    if (!insertedRow) {
      const [conflictRow] = await tx
        .select()
        .from(orderIdempotencyKeys)
        .where(eq(orderIdempotencyKeys.idempotencyKey, params.idempotencyKey))
        .limit(1);

      if (conflictRow?.orderId) {
        const [conflictOrder] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, conflictRow.orderId))
          .limit(1);

        if (conflictOrder) {
          return { order: conflictOrder, idempotencyHit: true, row: conflictRow };
        }
      }

      return { order: null, idempotencyHit: true, row: conflictRow ?? null };
    }

    const [createdOrder] = await tx.insert(orders).values(params.values).returning();

    await tx
      .update(orderIdempotencyKeys)
      .set({ orderId: createdOrder.id, updatedAt: new Date() })
      .where(eq(orderIdempotencyKeys.idempotencyKey, params.idempotencyKey));

    return { order: createdOrder, idempotencyHit: false, row: insertedRow };
  });
}

function sendApiError(
  res: Response,
  status: number,
  payload: { code: string; reason: string; details?: unknown }
) {
  return res.status(status).json(payload);
}

function isCheckoutSessionId(value: string) {
  // Stripe checkout session IDs start with "cs_"
  return value.startsWith("cs_") && value.length > 10;
}

function resolveCustomerDetails(parsed: {
  customerName?: string | undefined;
  customerEmail?: string | undefined;
  customerAddress?: string | undefined;
  customerCity?: string | undefined;
  customerZip?: string | undefined;
  name?: string | undefined;
  email?: string | undefined;
  address?: { line1: string; city: string; zip: string; country?: string | undefined } | undefined;
}) {
  const name = parsed.customerName ?? parsed.name ?? "";
  const email = parsed.customerEmail ?? parsed.email ?? "";
  const addressLine1 = parsed.customerAddress ?? parsed.address?.line1 ?? "";
  const city = parsed.customerCity ?? parsed.address?.city ?? "";
  const zip = parsed.customerZip ?? parsed.address?.zip ?? "";

  return {
    customerName: name,
    customerEmail: email,
    customerAddress: addressLine1,
    customerCity: city,
    customerZip: zip,
  };
}

function requireCustomerDetails(
  res: Response,
  details: ReturnType<typeof resolveCustomerDetails>
): details is {
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  customerCity: string;
  customerZip: string;
} {
  const missing = Object.entries(details)
    .filter(([, value]) => !String(value || "").trim())
    .map(([key]) => key);

  if (missing.length === 0) {
    return true;
  }

  sendApiError(res, 400, {
    code: "invalid_customer_details",
    reason: "invalid_customer_details",
    details: { missing },
  });
  return false;
}

// -----------------------------
// Validation
// -----------------------------

const CheckoutItemSchema = z.object({
  productId: z.string().min(1).max(80),
  quantity: z.coerce.number().int().min(1).max(20),
  size: z.string().optional().nullable(),
});

const CustomerDetailsSchema = z.object({
  customerName: z.string().min(1).max(120).optional(),
  customerEmail: z.string().email().optional(),
  customerAddress: z.string().min(1).max(240).optional(),
  customerCity: z.string().min(1).max(120).optional(),
  customerZip: z.string().min(1).max(20).optional(),
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  address: z
    .object({
      line1: z.string().min(1).max(240),
      city: z.string().min(1).max(120),
      zip: z.string().min(1).max(20),
      country: z.string().optional(),
    })
    .optional(),
});

const CreateSessionSchema = z
  .object({
    items: z.array(CheckoutItemSchema).min(1),
    // ✅ FIX: allow pickup too
    shippingMethod: z.enum(["gls", "pickup"]).default("gls"),
    paymentMethod: paymentMethodEnum.optional(),
    idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .and(CustomerDetailsSchema);

const CreateCodOrderSchema = z
  .object({
    items: z.array(CheckoutItemSchema).min(1),
    // ✅ FIX: allow pickup too
    shippingMethod: z.enum(["gls", "pickup"]).default("gls"),
    paymentMethod: paymentMethodEnum.optional(),
    idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .and(CustomerDetailsSchema);

const CreateInPersonOrderSchema = z
  .object({
    items: z.array(CheckoutItemSchema).min(1),
    shippingMethod: z.enum(["gls", "pickup"]).default("pickup"),
    paymentMethod: paymentMethodEnum.optional(),
    idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .and(CustomerDetailsSchema);

// -----------------------------
// Routes
// -----------------------------

export async function registerRoutes(app: Express) {
  // NOTE: server/index.ts already registers express.json() with a rawBody verifier.
  // Keeping this here is harmless but redundant.
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  registerOpsRoutes(app);
  // Accounting exports (D3) — minimal paper / monthly invoices
  // Protect with EXPORT_TOKEN (header: x-export-token or query: ?token=...)
  function requireExportToken(req: Request, res: Response): boolean {
    const expected = process.env.EXPORT_TOKEN;
    if (!expected) {
      sendApiError(res, 503, {
        code: "exports_not_configured",
        reason: "exports_not_configured",
      });
      return false;
    }
    const provided = (req.headers["x-export-token"] as string | undefined) || (req.query.token as string | undefined);
    if (!provided || provided !== expected) {
      sendApiError(res, 401, {
        code: "unauthorized",
        reason: "unauthorized",
      });
      return false;
    }
    return true;
  }

  app.get("/api/exports/orders.csv", async (req, res) => {
    try {
      if (!requireExportToken(req, res)) return;
      const csv = await exportOrdersCsv();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      return res.status(200).send(csv);
    } catch (e: any) {
      return sendApiError(res, 500, {
        code: "export_failed",
        reason: "export_failed",
        details: { message: e?.message || "unknown" },
      });
    }
  });

  app.get("/api/exports/payouts.csv", async (req, res) => {
    try {
      if (!requireExportToken(req, res)) return;
      const csv = await exportPayoutsCsv();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      return res.status(200).send(csv);
    } catch (e: any) {
      return sendApiError(res, 500, {
        code: "export_failed",
        reason: "export_failed",
        details: { message: e?.message || "unknown" },
      });
    }
  });

  app.get("/api/exports/ledger.csv", async (req, res) => {
    try {
      if (!requireExportToken(req, res)) return;
      const csv = await exportLedgerCsv();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      return res.status(200).send(csv);
    } catch (e: any) {
      return sendApiError(res, 500, {
        code: "export_failed",
        reason: "export_failed",
        details: { message: e?.message || "unknown" },
      });
    }
  });

  app.get("/api/shipping/options", (_req, res) => {
    res.json({
      shippingOptions: getShippingOptionsForApi(),
    });
  });

  // Checkout: quote totals (shipping + COD availability/fee) — used for micro-UX recalculation
  app.post("/api/checkout/quote", async (req, res) => {
    try {
      const QuoteSchema = z.object({
        items: z.array(CheckoutItemSchema).min(1),
        // ✅ FIX: allow pickup too
        shippingMethod: z.enum(["gls", "pickup"]).default("gls"),
        paymentMethod: paymentMethodEnum.optional(),
      });

      const parsed = QuoteSchema.parse(req.body);

      let subtotalCzk = 0;
      for (const item of parsed.items) {
        const product = await storage.getProduct(item.productId);
        if (!product) {
          return sendApiError(res, 400, {
            code: "unknown_product",
            reason: "unknown_product",
            details: { productId: item.productId },
          });
        }

        const unitPriceCzk = Number(product.price) || 0;
        if (unitPriceCzk <= 0) {
          return sendApiError(res, 400, {
            code: "invalid_product_price",
            reason: "invalid_product_price",
            details: { productId: product.id },
          });
        }

        subtotalCzk += unitPriceCzk * item.quantity;
      }

      const shipping = SHIPPING_METHODS[parsed.shippingMethod as ShippingMethodId];
      if (!shipping) {
        return sendApiError(res, 400, {
          code: "invalid_shipping_method",
          reason: "invalid_shipping_method",
        });
      }

      if (parsed.paymentMethod) {
        const paymentCheck = validatePaymentForShipping(
          parsed.shippingMethod as ShippingMethodId,
          parsed.paymentMethod
        );
        if (!paymentCheck.ok) {
          return sendApiError(res, 400, {
            code: paymentCheck.code,
            reason: paymentCheck.reason,
            details: {
              shippingMethod: parsed.shippingMethod,
              paymentMethod: parsed.paymentMethod,
            },
          });
        }
      }

      const normalizedPaymentMethod = parsed.paymentMethod === "cod" ? "cod" : "card";
      const totals = calculateTotals({
        subtotalCzk,
        shippingId: parsed.shippingMethod as ShippingMethodId,
        paymentMethod: normalizedPaymentMethod,
      });

      const paymentConstraints = getPaymentConstraintsForShipping(parsed.shippingMethod as ShippingMethodId);

      return res.json({
        totals,
        shippingOptions: getShippingOptionsForApi(),
        paymentConstraints,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return sendApiError(res, 400, {
          code: "invalid_payload",
          reason: "invalid_payload",
          details: err.flatten(),
        });
      }

      const message = err?.message || "unknown_error";
      return sendApiError(res, 400, {
        code: "invalid_request",
        reason: "invalid_request",
        details: { message },
      });
    }
  });
  // Products
  app.get("/api/products", async (_req, res) => {
    try {
      const products = await storage.getProducts();
      return res.json(products);
    } catch {
      return sendApiError(res, 500, {
        code: "failed_to_load_products",
        reason: "failed_to_load_products",
      });
    }
  });

  // Checkout: create Stripe session (server-authoritative pricing + creates DB order)
  app.post("/api/checkout/create-session", async (req, res) => {
    try {
      const stripe = await getUncachableStripeClient().catch(() => null);
      if (!stripe) {
        return sendApiError(res, 500, {
          code: "stripe_not_configured",
          reason: "stripe_not_configured",
        });
      }

      const parsed = CreateSessionSchema.parse(req.body);
      const customerDetails = resolveCustomerDetails(parsed);
      if (!requireCustomerDetails(res, customerDetails)) {
        return;
      }

      // If user selected crypto, we currently don't route through Stripe.
      const pm = (parsed.paymentMethod || "card") as PaymentMethod;
      const paymentCheck = validatePaymentForShipping(parsed.shippingMethod as ShippingMethodId, pm);
      if (!paymentCheck.ok) {
        return sendApiError(res, 400, {
          code: paymentCheck.code,
          reason: paymentCheck.reason,
          details: {
            shippingMethod: parsed.shippingMethod,
            paymentMethod: pm,
          },
        });
      }
      // This endpoint only supports Stripe-based methods.
      if (pm !== "card" && pm !== "gpay" && pm !== "applepay") {
        return sendApiError(res, 400, {
          code: "payment_not_allowed_for_shipping",
          reason: "Zvolená platba není pro Stripe dostupná.",
          details: {
            shippingMethod: parsed.shippingMethod,
            paymentMethod: pm,
          },
        });
      }

      // Server builds line items from DB (never trust client price)
      const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      let subtotalCzk = 0;

      for (const item of parsed.items) {
        const product = await storage.getProduct(item.productId);
        if (!product) {
          return sendApiError(res, 400, {
            code: "unknown_product",
            reason: "unknown_product",
            details: { productId: item.productId },
          });
        }

        const unitPriceCzk = Number(product.price) || 0;
        if (unitPriceCzk <= 0) {
          return sendApiError(res, 400, {
            code: "invalid_product_price",
            reason: "invalid_product_price",
            details: { productId: product.id },
          });
        }

        subtotalCzk += unitPriceCzk * item.quantity;

        // ✅ Stripe accepts ONLY absolute URLs in product_data.images
        const rawImg = (product as any).image;
        const stripeImages =
          typeof rawImg === "string" && /^https?:\/\//i.test(rawImg) ? [rawImg] : undefined;

        line_items.push({
          quantity: item.quantity,
          price_data: {
            currency: "czk",
            unit_amount: CZK_TO_STRIPE(unitPriceCzk),
            product_data: {
              name: product.name,
              metadata: item.size ? { size: String(item.size) } : undefined,
              // Use stored image fields (never trust client) — but only if absolute URL
              images: stripeImages,
            },
          },
        });
      }

      const shipping = SHIPPING_METHODS[parsed.shippingMethod as ShippingMethodId];
      if (!shipping) {
        return sendApiError(res, 400, {
          code: "unknown_shipping_method",
          reason: "unknown_shipping_method",
        });
      }

      const totals = calculateTotals({
        subtotalCzk,
        shippingId: parsed.shippingMethod as ShippingMethodId,
        paymentMethod: "card",
      });

      if (shipping.priceCzk > 0) {
        line_items.push({
          quantity: 1,
          price_data: {
            currency: "czk",
            unit_amount: CZK_TO_STRIPE(shipping.priceCzk),
            product_data: {
              name: `Doprava: ${shipping.label}`,
            },
          },
        });
      }

      const totalCzk = totals.totalCzk;

      // Stripe minimum guard (avoid ugly 500s)
      if (totalCzk < 15) {
        return sendApiError(res, 400, {
          code: "amount_too_small",
          reason: "amount_too_small",
          details: { totalCzk },
        });
      }

      const idempotencyKey = parsed.idempotencyKey;

      // ✅ Create order in DB FIRST (pending/unpaid) with idempotency guard
      const orderValues: InsertOrder = {
        accessToken: generateOrderAccessToken(),
        customerName: customerDetails.customerName,
        customerEmail: customerDetails.customerEmail,
        customerAddress: customerDetails.customerAddress,
        customerCity: customerDetails.customerCity,
        customerZip: customerDetails.customerZip,
        items: JSON.stringify({
          items: parsed.items,
          shippingMethod: parsed.shippingMethod,
          shippingLabel: shipping.label,
          subtotalCzk,
          shippingCzk: shipping.priceCzk,
          codAvailable: shipping.codAvailable,
          codFeeCzk: shipping.codFeeCzk ?? 0,
          codCzk: totals.codFeeCzk,
          totalCzk,
        }),
        total: Math.round(totalCzk),
        paymentMethod: pm,
        // userId is optional (guest checkout)
        userId: null as any,
      };

      const { order, idempotencyHit, row } = await createOrderWithIdempotency({
        idempotencyKey,
        paymentMethod: pm,
        values: orderValues,
      });

      if (!order) {
        return sendApiError(res, 409, {
          code: "order_in_progress",
          reason: "order_in_progress",
        });
      }

      if (idempotencyHit && row?.stripeSessionUrl) {
        return res.json({
          url: row.stripeSessionUrl,
          orderId: order.id,
          accessToken: order.accessToken,
          idempotency: "hit",
        });
      }

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
        return sendApiError(res, 500, {
          code: "invalid_base_url",
          reason: "invalid_base_url",
          details: { message: e?.message || "invalid_url" },
        });
      }

      if (idempotencyHit && order.paymentStatus === "paid") {
        return res.json({
          url: `${baseUrl}/success?order_id=${order.id}`,
          orderId: order.id,
          accessToken: order.accessToken,
          idempotency: "hit",
        });
      }

      const successUrl = `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`;
      const cancelUrl = order.accessToken
        ? `${baseUrl}/cancel?order_id=${order.id}&token=${order.accessToken}`
        : `${baseUrl}/cancel?order_id=${order.id}`;

      if (!order.accessToken) {
        console.warn("[checkout] create-session order missing access token for cancel_url", {
          orderId: order.id,
          idempotencyKey,
        });
      }

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
        return sendApiError(res, 500, {
          code: "invalid_redirect_url",
          reason: "invalid_redirect_url",
          details: { message: e?.message || "invalid_url" },
        });
      }

      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            currency: "czk",
            line_items,
            success_url: successUrl,
            cancel_url: cancelUrl,
            customer_email: customerDetails.customerEmail,
            client_reference_id: order.id,
            metadata: {
              orderId: order.id,
              idempotencyKey,
              customerName: customerDetails.customerName,
              customerAddress: customerDetails.customerAddress,
              customerCity: customerDetails.customerCity,
              customerZip: customerDetails.customerZip,
              shippingMethod: parsed.shippingMethod,
              subtotalCzk: String(subtotalCzk),
              shippingCzk: String(shipping.priceCzk),
              totalCzk: String(totalCzk),
            },
          },
          {
            idempotencyKey,
          }
        );
      } catch (e) {
        // Prevent orphan orders if Stripe session creation fails
        try {
          await storage.updateOrder(order.id, { status: "cancelled", paymentStatus: "unpaid" });
        } catch (updateErr) {
          console.error("[checkout] failed to cancel order after Stripe error:", {
            orderId: order.id,
            error: (updateErr as any)?.message,
          });
        }
        throw e;
      }

      if (!session.url) {
        return sendApiError(res, 500, {
          code: "missing_session_url",
          reason: "missing_session_url",
        });
      }
      await db
        .update(orderIdempotencyKeys)
        .set({
          stripeSessionId: session.id,
          stripeSessionUrl: session.url,
          updatedAt: new Date(),
        })
        .where(eq(orderIdempotencyKeys.idempotencyKey, idempotencyKey));

      return res.json({ url: session.url, orderId: order.id, accessToken: order.accessToken });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return sendApiError(res, 400, {
          code: "invalid_payload",
          reason: "invalid_payload",
          details: err.flatten(),
        });
      }

      const message = err?.message || "unknown_error";
      console.error("[checkout] create-session failed:", err);
      return sendApiError(res, 500, {
        code: "failed_to_create_session",
        reason: "failed_to_create_session",
        details: { message },
      });
    }
  });

  // ✅ Dobírka (COD): create DB order without Stripe
  app.post("/api/checkout/create-cod-order", async (req, res) => {
    try {
      const parsed = CreateCodOrderSchema.parse(req.body);
      const customerDetails = resolveCustomerDetails(parsed);
      if (!requireCustomerDetails(res, customerDetails)) {
        return;
      }
      const paymentMethod = parsed.paymentMethod;

      if (paymentMethod !== "cod" || parsed.shippingMethod !== "gls") {
        return sendApiError(res, 400, {
          code: "payment_not_allowed_for_shipping",
          reason: "Dobírka je dostupná jen pro doručení GLS.",
          details: {
            shippingMethod: parsed.shippingMethod,
            paymentMethod: paymentMethod ?? null,
          },
        });
      }

      const paymentCheck = validatePaymentForShipping(parsed.shippingMethod as ShippingMethodId, paymentMethod);
      if (!paymentCheck.ok) {
        return sendApiError(res, 400, {
          code: paymentCheck.code,
          reason: paymentCheck.reason,
          details: {
            shippingMethod: parsed.shippingMethod,
            paymentMethod,
          },
        });
      }

      // Server authoritative pricing (same logic as Stripe flow, but no session)
      let subtotalCzk = 0;
      for (const item of parsed.items) {
        const product = await storage.getProduct(item.productId);
        if (!product) {
          return sendApiError(res, 400, {
            code: "unknown_product",
            reason: "unknown_product",
            details: { productId: item.productId },
          });
        }

        const unitPriceCzk = Number(product.price) || 0;
        if (unitPriceCzk <= 0) {
          return sendApiError(res, 400, {
            code: "invalid_product_price",
            reason: "invalid_product_price",
            details: { productId: product.id },
          });
        }

        subtotalCzk += unitPriceCzk * item.quantity;
      }

      const shipping = SHIPPING_METHODS[parsed.shippingMethod as ShippingMethodId];
      if (!shipping) {
        return sendApiError(res, 400, {
          code: "unknown_shipping_method",
          reason: "unknown_shipping_method",
        });
      }

      const totals = calculateTotals({
        subtotalCzk,
        shippingId: parsed.shippingMethod as ShippingMethodId,
        paymentMethod: "cod",
      });

      const totalCzk = totals.totalCzk;
      if (totalCzk < 15) {
        return sendApiError(res, 400, {
          code: "amount_too_small",
          reason: "amount_too_small",
          details: { totalCzk },
        });
      }

      const idempotencyKey = parsed.idempotencyKey;

      const orderValues: InsertOrder = {
        accessToken: generateOrderAccessToken(),
        customerName: customerDetails.customerName,
        customerEmail: customerDetails.customerEmail,
        customerAddress: customerDetails.customerAddress,
        customerCity: customerDetails.customerCity,
        customerZip: customerDetails.customerZip,
        items: JSON.stringify({
          items: parsed.items,
          shippingMethod: parsed.shippingMethod,
          shippingLabel: shipping.label,
          subtotalCzk,
          shippingCzk: shipping.priceCzk,
          codAvailable: shipping.codAvailable,
          codFeeCzk: shipping.codFeeCzk ?? 0,
          codCzk: totals.codFeeCzk,
          totalCzk,
        }),
        total: Math.round(totalCzk),
        paymentMethod: "cod" as PaymentMethod,
        userId: null as any,
      };

      const { order, idempotencyHit } = await createOrderWithIdempotency({
        idempotencyKey,
        paymentMethod: "cod",
        values: orderValues,
      });

      if (!order) {
        return sendApiError(res, 409, {
          code: "order_in_progress",
          reason: "order_in_progress",
        });
      }

      // Reserve/deduct stock immediately for COD (keeps inventory consistent)
      const needsStockDeduction = !order.stockDeductedAt;

      if (needsStockDeduction) {
        try {
          await atomicStockDeduction(order.id, parsed.items as any);
          await db
            .update(orders)
            .set({ stockDeductedAt: new Date() })
            .where(eq(orders.id, order.id));

          // Mark COD order as confirmed (stock reserved) but unpaid
          await storage.updateOrder(order.id, {
            status: "confirmed",
            paymentStatus: "unpaid",
          });
        } catch (e) {
          // If stock deduction fails, cancel the order to avoid phantom reservations
          await storage.updateOrder(order.id, {
            status: "cancelled",
            paymentStatus: "unpaid",
          });
          console.error("[cod] stock deduction failed; order cancelled", {
            orderId: order.id,
            error: (e as any)?.message,
          });
          return sendApiError(res, 409, {
            code: "out_of_stock_or_reservation_failed",
            reason: "out_of_stock_or_reservation_failed",
            details: { orderId: order.id },
          });
        }
      }

      if (!idempotencyHit) {
        // Notify fulfillment immediately (COD is created without Stripe)
        const orderForEmail = { ...order, status: "confirmed", paymentStatus: "unpaid" } as any;

        sendFulfillmentNewOrderEmail(orderForEmail).catch((err) =>
          console.error("[cod] Failed to send fulfillment email:", err)
        );

        // Customer confirmation email (best-effort)
        sendOrderConfirmationEmail(orderForEmail).catch((err) =>
          console.error("[cod] Failed to send customer confirmation email:", err)
        );
      }

      return res.json({
        success: true,
        orderId: order.id,
        accessToken: order.accessToken,
        idempotency: idempotencyHit ? "hit" : "new",
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return sendApiError(res, 400, {
          code: "invalid_payload",
          reason: "invalid_payload",
          details: err.flatten(),
        });
      }

      const message = err?.message || "unknown_error";
      console.error("[cod] create order failed:", err);
      return sendApiError(res, 500, {
        code: "failed_to_create_cod_order",
        reason: "failed_to_create_cod_order",
        details: { message },
      });
    }
  });

  // ✅ Platba na místě (in-person): create DB order without Stripe
  app.post("/api/checkout/create-in-person-order", async (req, res) => {
    try {
      const parsed = CreateInPersonOrderSchema.parse(req.body);
      const customerDetails = resolveCustomerDetails(parsed);
      if (!requireCustomerDetails(res, customerDetails)) {
        return;
      }
      const paymentMethod = parsed.paymentMethod;

      if (paymentMethod !== "in_person" || parsed.shippingMethod !== "pickup") {
        return sendApiError(res, 400, {
          code: "payment_not_allowed_for_shipping",
          reason: "Platba na místě je dostupná jen pro osobní odběr.",
          details: {
            shippingMethod: parsed.shippingMethod,
            paymentMethod: paymentMethod ?? null,
          },
        });
      }

      const paymentCheck = validatePaymentForShipping(parsed.shippingMethod as ShippingMethodId, paymentMethod);
      if (!paymentCheck.ok) {
        return sendApiError(res, 400, {
          code: paymentCheck.code,
          reason: paymentCheck.reason,
          details: {
            shippingMethod: parsed.shippingMethod,
            paymentMethod,
          },
        });
      }

      // Server authoritative pricing (same logic as Stripe flow, but no session)
      let subtotalCzk = 0;
      for (const item of parsed.items) {
        const product = await storage.getProduct(item.productId);
        if (!product) {
          return sendApiError(res, 400, {
            code: "unknown_product",
            reason: "unknown_product",
            details: { productId: item.productId },
          });
        }

        const unitPriceCzk = Number(product.price) || 0;
        if (unitPriceCzk <= 0) {
          return sendApiError(res, 400, {
            code: "invalid_product_price",
            reason: "invalid_product_price",
            details: { productId: product.id },
          });
        }

        subtotalCzk += unitPriceCzk * item.quantity;
      }

      const shipping = SHIPPING_METHODS[parsed.shippingMethod as ShippingMethodId];
      if (!shipping) {
        return sendApiError(res, 400, {
          code: "unknown_shipping_method",
          reason: "unknown_shipping_method",
        });
      }

      const totals = calculateTotals({
        subtotalCzk,
        shippingId: parsed.shippingMethod as ShippingMethodId,
        paymentMethod: "card",
      });

      const totalCzk = totals.totalCzk;
      if (totalCzk < 15) {
        return sendApiError(res, 400, {
          code: "amount_too_small",
          reason: "amount_too_small",
          details: { totalCzk },
        });
      }

      const idempotencyKey = parsed.idempotencyKey;

      const orderValues: InsertOrder = {
        accessToken: generateOrderAccessToken(),
        customerName: customerDetails.customerName,
        customerEmail: customerDetails.customerEmail,
        customerAddress: customerDetails.customerAddress,
        customerCity: customerDetails.customerCity,
        customerZip: customerDetails.customerZip,
        items: JSON.stringify({
          items: parsed.items,
          shippingMethod: parsed.shippingMethod,
          shippingLabel: shipping.label,
          subtotalCzk,
          shippingCzk: shipping.priceCzk,
          codAvailable: shipping.codAvailable,
          codFeeCzk: shipping.codFeeCzk ?? 0,
          codCzk: totals.codFeeCzk,
          totalCzk,
        }),
        total: Math.round(totalCzk),
        paymentMethod: "in_person" as PaymentMethod,
        userId: null as any,
      };

      const { order, idempotencyHit } = await createOrderWithIdempotency({
        idempotencyKey,
        paymentMethod: "in_person",
        values: orderValues,
      });

      if (!order) {
        return sendApiError(res, 409, {
          code: "order_in_progress",
          reason: "order_in_progress",
        });
      }

      const needsStockDeduction = !order.stockDeductedAt;

      if (needsStockDeduction) {
        try {
          await atomicStockDeduction(order.id, parsed.items as any);
          await db
            .update(orders)
            .set({ stockDeductedAt: new Date() })
            .where(eq(orders.id, order.id));

          await storage.updateOrder(order.id, {
            status: "confirmed",
            paymentStatus: "unpaid",
          });
        } catch (e) {
          await storage.updateOrder(order.id, {
            status: "cancelled",
            paymentStatus: "unpaid",
          });
          console.error("[in-person] stock deduction failed; order cancelled", {
            orderId: order.id,
            error: (e as any)?.message,
          });
          return sendApiError(res, 409, {
            code: "out_of_stock_or_reservation_failed",
            reason: "out_of_stock_or_reservation_failed",
            details: { orderId: order.id },
          });
        }
      }

      if (!idempotencyHit) {
        const orderForEmail = { ...order, status: "confirmed", paymentStatus: "unpaid" } as any;

        sendFulfillmentNewOrderEmail(orderForEmail).catch((err) =>
          console.error("[in-person] Failed to send fulfillment email:", err)
        );

        sendOrderConfirmationEmail(orderForEmail).catch((err) =>
          console.error("[in-person] Failed to send customer confirmation email:", err)
        );
      }

      return res.json({
        success: true,
        orderId: order.id,
        accessToken: order.accessToken,
        idempotency: idempotencyHit ? "hit" : "new",
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return sendApiError(res, 400, {
          code: "invalid_payload",
          reason: "invalid_payload",
          details: err.flatten(),
        });
      }

      const message = err?.message || "unknown_error";
      console.error("[in-person] create order failed:", err);
      return sendApiError(res, 500, {
        code: "failed_to_create_in_person_order",
        reason: "failed_to_create_in_person_order",
        details: { message },
      });
    }
  });

  // ✅ Cancel an unpaid order (requires order access token; used by /checkout/cancel page)
  app.post("/api/checkout/cancel/:orderId", async (req, res) => {
    try {
      const orderId = String(req.params.orderId || "");
      if (!orderId) {
        return sendApiError(res, 400, {
          code: "missing_order_id",
          reason: "missing_order_id",
        });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return sendApiError(res, 404, {
          code: "order_not_found",
          reason: "order_not_found",
        });
      }

      // Token is required to cancel guest/public orders safely.
      const providedToken = getOrderAccessTokenFromRequest(req);
      if (!providedToken) {
        return sendApiError(res, 401, {
          code: "missing_order_token",
          reason: "missing_order_token",
        });
      }

      if (!order.accessToken) {
        return sendApiError(res, 409, {
          code: "token_required",
          reason: "token_required",
          details: { orderId },
        });
      }

      if (providedToken !== order.accessToken) {
        return sendApiError(res, 403, {
          code: "invalid_order_token",
          reason: "invalid_order_token",
        });
      }

      // If already paid/confirmed, we do NOT cancel here.
      if (order.paymentStatus === "paid" || order.status === "confirmed") {
        return sendApiError(res, 409, {
          code: "cannot_cancel_paid_order",
          reason: "cannot_cancel_paid_order",
          details: { orderId },
        });
      }

      if (order.status === "cancelled") {
        return res.json({ success: true, orderId, alreadyCancelled: true });
      }

      if (order.stockDeductedAt) {
        const rawItems = JSON.parse(order.items as string);
        const parsedItems: CartItem[] = Array.isArray(rawItems) ? rawItems : (rawItems?.items || []);
        const aggregated = new Map<string, number>();

        for (const item of parsedItems) {
          const prev = aggregated.get(item.productId) ?? 0;
          aggregated.set(item.productId, prev + Number(item.quantity || 0));
        }

        await db.transaction(async (tx) => {
          const aggregatedItems = Array.from(aggregated.entries())
            .filter(([, quantity]) => Number.isFinite(quantity) && quantity > 0)
            .sort(([a], [b]) => String(a).localeCompare(String(b)));

          for (const [productId] of aggregatedItems) {
            await tx.execute(sql`SELECT stock FROM products WHERE id = ${productId} FOR UPDATE`);
          }

          for (const [productId, quantity] of aggregatedItems) {
            await tx
              .update(products)
              .set({
                stock: sql`${products.stock} + ${quantity}`,
              })
              .where(eq(products.id, productId));
          }

          await tx
            .update(orders)
            .set({
              stockDeductedAt: null,
              status: "cancelled",
              paymentStatus: order.paymentStatus || "unpaid",
            })
            .where(eq(orders.id, orderId));
        });
      } else {
        await storage.updateOrder(orderId, {
          status: "cancelled",
          paymentStatus: order.paymentStatus || "unpaid",
        });
      }

      return res.json({ success: true, orderId });
    } catch (err: any) {
      const message = err?.message || "unknown_error";
      console.error("[checkout] cancel failed:", err);
      return sendApiError(res, 500, {
        code: "failed_to_cancel",
        reason: "failed_to_cancel",
        details: { message },
      });
    }
  });

  // Checkout: order summary (PII requires matching order access token)
  app.get("/api/checkout/order-summary/:orderId", async (req, res) => {
    try {
      const orderId = String(req.params.orderId || "").trim();
      if (!orderId) {
        return sendApiError(res, 400, {
          code: "missing_order_id",
          reason: "missing_order_id",
        });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return sendApiError(res, 404, {
          code: "order_not_found",
          reason: "order_not_found",
        });
      }

      let payload: any = null;
      try {
        payload = order.items ? JSON.parse(order.items as any) : null;
      } catch {
        payload = null;
      }

      const providedToken = getOrderAccessTokenFromRequest(req);
      const hasValidToken = Boolean(order.accessToken && providedToken && providedToken === order.accessToken);

      const safePayload = {
        success: true,
        orderId: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        totalCzk: typeof (order as any).total === "number" ? (order as any).total : Number((order as any).total),
        shippingMethod: payload?.shippingMethod ?? null,
        shippingLabel: payload?.shippingLabel ?? null,
        shippingCzk: payload?.shippingCzk ?? null,
        codFeeCzk: payload?.codFeeCzk ?? null,
        codCzk: payload?.codCzk ?? null,
        subtotalCzk: payload?.subtotalCzk ?? null,
      };

      if (!hasValidToken) {
        return res.json(safePayload);
      }

      return res.json({
        ...safePayload,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerAddress: order.customerAddress,
        customerCity: order.customerCity,
        customerZip: order.customerZip,
      });
    } catch (err: any) {
      const message = err?.message || "unknown_error";
      console.error("[checkout] order-summary failed:", err);
      return sendApiError(res, 500, {
        code: "failed_to_get_order_summary",
        reason: "failed_to_get_order_summary",
        details: { message },
      });
    }
  });

  // ✅ Verify Stripe session after redirect (unblocks success page)
  app.get("/api/checkout/verify/:sessionId", async (req, res) => {
    try {
      const stripe = await getUncachableStripeClient().catch(() => null);
      if (!stripe) {
        return sendApiError(res, 500, {
          code: "stripe_not_configured",
          reason: "stripe_not_configured",
        });
      }

      const sessionId = String(req.params.sessionId || "");
      if (!isCheckoutSessionId(sessionId)) {
        return sendApiError(res, 400, {
          code: "invalid_session_id",
          reason: "invalid_session_id",
        });
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent"],
      });

      const paymentStatus = session.payment_status; // "paid" | "unpaid" | "no_payment_required"
      let orderIdFromMeta = (session.metadata?.orderId || session.client_reference_id || null) as string | null;
      const idempotencyKey = session.metadata?.idempotencyKey || null;

      if (!orderIdFromMeta && idempotencyKey) {
        const { order } = await fetchOrderByIdempotencyKey(String(idempotencyKey));
        orderIdFromMeta = order?.id ?? null;
      }

      if (paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
        return res.json({
          success: false,
          reason: "not_paid",
          paymentStatus,
          orderId: orderIdFromMeta,
          retryAfterMs: 2500,
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
      return sendApiError(res, 500, {
        code: "failed_to_verify_session",
        reason: "failed_to_verify_session",
        details: { message },
      });
    }
  });
}

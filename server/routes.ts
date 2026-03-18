// server/routes.ts

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
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
import { paymentMethodEnum, type PaymentMethod, orders, orderEvents, auditLog, orderIdempotencyKeys, products, type CartItem, type Order, type InsertOrder } from "../shared/schema";
import { getUncachableStripeClient } from "./stripeClient";
import { sendBankTransferPendingEmail, sendFulfillmentNewOrderEmail, sendOrderConfirmationEmail } from "./emailService";
import { finalizePaidOrder } from "./paymentPipeline";
import { deductStockOnceWithOrderLock } from "./webhookHandlers";
import { resolveAuthoritativeStripeOrder } from "./stripeOrderAuthority";
import { createCoinGateOrder, mapCoinGateStatus, retrieveCoinGateOrder } from "./coingate";
import { env } from "./env";
import { exportLedgerCsv, exportOrdersCsv, exportPayoutsCsv } from "./exports";
import { registerOpsRoutes } from "./opsRoutes";
import { emitOrderEvent, OpsEventType } from "./ops/events";
import { db } from "./db";
import { and, desc, eq, gte, sql } from "drizzle-orm";

// -----------------------------
// Stripe setup
// -----------------------------

// Stripe client is created lazily via stripeClient (Render-first safe)

// Stripe expects amounts in the smallest currency unit.
// We intentionally store CZK as "xx.xx" in Stripe by multiplying by 100.
const CZK_TO_STRIPE = (czk: number) => Math.round(czk * 100);
const STRIPE_TO_CZK = (unitAmount: number | null | undefined) =>
  typeof unitAmount === "number" ? unitAmount / 100 : null;
const STRIPE_LIKE_PAYMENT_METHODS = new Set<PaymentMethod>(["card", "gpay", "applepay"]);

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

async function createOrderWithIdempotency(params: {
  idempotencyKey: string;
  paymentMethod: PaymentMethod;
  values: InsertOrder;
  fingerprint?: string;
}) {
  const isCancelledOrder = (order: Order | null | undefined) => order?.status === "cancelled";
  const lockIdempotencyRow = async (tx: any) => {
    const lockResult = await tx.execute(sql<{ idempotency_key: string; order_id: string | null; payment_method: string | null }>`
      SELECT idempotency_key, order_id, payment_method
      FROM order_idempotency_keys
      WHERE idempotency_key = ${params.idempotencyKey}
      FOR UPDATE
    `);
    return lockResult.rows?.[0] ?? null;
  };

  const resolveLockedMappedOrder = async (tx: any, lockedRow: { idempotency_key: string; order_id: string | null; payment_method: string | null } | null) => {
    if (!lockedRow?.order_id) {
      return null;
    }

    const [mappedOrder] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, String(lockedRow.order_id)))
      .limit(1);

    if (!mappedOrder) {
      return null;
    }

    if (!isCancelledOrder(mappedOrder)) {
      const [currentRow] = await tx
        .select()
        .from(orderIdempotencyKeys)
        .where(eq(orderIdempotencyKeys.idempotencyKey, params.idempotencyKey))
        .limit(1);
      return { order: mappedOrder, idempotencyHit: true, row: currentRow ?? null, fingerprintHit: false as const };
    }

    const [createdOrder] = await tx.insert(orders).values(params.values).returning();
    await tx
      .update(orderIdempotencyKeys)
      .set({ orderId: createdOrder.id, paymentMethod: params.paymentMethod, updatedAt: new Date() })
      .where(eq(orderIdempotencyKeys.idempotencyKey, params.idempotencyKey));

    const [remappedRow] = await tx
      .select()
      .from(orderIdempotencyKeys)
      .where(eq(orderIdempotencyKeys.idempotencyKey, params.idempotencyKey))
      .limit(1);

    console.info("[checkout] cancelled-order idempotency remap", {
      idempotencyKey: params.idempotencyKey.slice(0, 16),
      fromOrderId: mappedOrder.id,
      toOrderId: createdOrder.id,
    });

    return { order: createdOrder, idempotencyHit: false, row: remappedRow ?? null, fingerprintHit: false as const };
  };

  return db.transaction(async (tx) => {
    if (params.fingerprint) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${params.fingerprint}))`);

      const [existingFingerprintOrder] = await tx
        .select()
        .from(orders)
        .where(and(
          eq(orders.fingerprint, params.fingerprint),
          eq(orders.status, "pending"),
          eq(orders.paymentStatus, "unpaid"),
          gte(orders.createdAt, sql`NOW() - INTERVAL '10 minutes'`)
        ))
        .orderBy(desc(orders.createdAt))
        .limit(1);

      if (existingFingerprintOrder) {
        const [mappedRow] = await tx
          .insert(orderIdempotencyKeys)
          .values({
            idempotencyKey: params.idempotencyKey,
            paymentMethod: params.paymentMethod,
            orderId: existingFingerprintOrder.id,
          })
          .onConflictDoUpdate({
            target: orderIdempotencyKeys.idempotencyKey,
            set: {
              orderId: existingFingerprintOrder.id,
              paymentMethod: params.paymentMethod,
              updatedAt: new Date(),
            },
          })
          .returning();

        console.log(
          `[checkout] order reuse hit fingerprint=${params.fingerprint.slice(0, 12)} order=${existingFingerprintOrder.id}`
        );
        return {
          order: existingFingerprintOrder,
          idempotencyHit: true,
          row: mappedRow ?? null,
          fingerprintHit: true,
        };
      }
    }

    const lockedExistingRow = await lockIdempotencyRow(tx);
    const lockedExistingResolution = await resolveLockedMappedOrder(tx, lockedExistingRow);
    if (lockedExistingResolution) {
      return lockedExistingResolution;
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
      const lockedConflictRow = await lockIdempotencyRow(tx);
      const lockedConflictResolution = await resolveLockedMappedOrder(tx, lockedConflictRow);
      if (lockedConflictResolution) {
        return lockedConflictResolution;
      }

      const [conflictRow] = await tx
        .select()
        .from(orderIdempotencyKeys)
        .where(eq(orderIdempotencyKeys.idempotencyKey, params.idempotencyKey))
        .limit(1);

      return { order: null, idempotencyHit: true, row: conflictRow ?? null, fingerprintHit: false };
    }

    const [createdOrder] = await tx.insert(orders).values(params.values).returning();

    await tx
      .update(orderIdempotencyKeys)
      .set({ orderId: createdOrder.id, updatedAt: new Date() })
      .where(eq(orderIdempotencyKeys.idempotencyKey, params.idempotencyKey));

    return { order: createdOrder, idempotencyHit: false, row: insertedRow, fingerprintHit: false };
  });
}

function buildOrderFingerprint(input: {
  items: Array<{ productId: string; quantity: number; unitPrice: number; size?: string | null }>;
  shippingMethod: string;
  paymentMethod: string;
  customerEmail: string;
  totalAmount: number;
  currency: string;
}) {
  const normalized = {
    currency: input.currency.toUpperCase(),
    customerEmail: input.customerEmail.trim().toLowerCase(),
    items: input.items
      .map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
        size: item.size ? String(item.size) : null,
        unitPrice: Math.round(Number(item.unitPrice)),
      }))
      .sort((a, b) => {
        if (a.productId === b.productId) {
          return String(a.size ?? "").localeCompare(String(b.size ?? ""));
        }
        return a.productId.localeCompare(b.productId);
      }),
    paymentMethod: input.paymentMethod,
    shippingMethod: input.shippingMethod,
    totalAmount: Math.round(Number(input.totalAmount)),
  };

  const payload = JSON.stringify(normalized);
  return createHash("sha256").update(payload).digest("hex");
}

function sendApiError(
  res: Response,
  status: number,
  payload: { code: string; reason: string; details?: unknown }
) {
  return res.status(status).json(payload);
}

function sendCheckoutError(
  res: Response,
  status: number,
  payload: { code: string; message: string; details?: unknown }
) {
  return res.status(status).json(payload);
}

function checkoutLog(meta: {
  requestId: string;
  route: string;
  result: "ok" | "fail";
  code: string;
  orderId?: string;
  fingerprint?: string;
  stripeRequestId?: string;
}) {
  console.info("checkout_create_session", meta);
}

function buildStripeIdempotencyKey(orderId: string, fingerprint: string, attempt: number): string {
  return createHash("sha256")
    .update(`${orderId}:${fingerprint}:${attempt}`)
    .digest("hex");
}

function mapStripeError(err: unknown):
  | { status: 500; code: "STRIPE_CONFIG_ERROR"; message: string; stripeRequestId?: string }
  | { status: 400; code: "STRIPE_INVALID_PARAMS"; message: string; stripeRequestId?: string }
  | { status: 409; code: "ORDER_STATE_CONFLICT"; message: string; stripeRequestId?: string; conflictState?: "already_paid" | "processing" }
  | null {
  const stripeErr = err as Stripe.StripeRawError & { type?: string; requestId?: string; code?: string };
  const stripeRequestId = stripeErr?.requestId;

  if (stripeErr?.message?.includes("apiKey") || stripeErr?.code === "api_key_expired") {
    return {
      status: 500,
      code: "STRIPE_CONFIG_ERROR",
      message: "Platba je dočasně nedostupná.",
      stripeRequestId,
    };
  }

  if (stripeErr?.type === "invalid_request_error") {
    return {
      status: 400,
      code: "STRIPE_INVALID_PARAMS",
      message: "Neplatné parametry platby.",
      stripeRequestId,
    };
  }

  if (stripeErr?.type === "idempotency_error") {
    return {
      status: 409,
      code: "ORDER_STATE_CONFLICT",
      message: "Objednávka je už ve stavu, který neumožňuje novou platbu.",
      stripeRequestId,
      conflictState: "processing",
    };
  }

  return null;
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
  // Optional guard if FE ever sends minor units for price previews.
  unitAmountMinor: z.number().int().positive().optional(),
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
    currency: z.literal("CZK").or(z.literal("czk")).optional().default("czk"),
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
  registerOpsRoutes(app);
  // Accounting exports (D3) — minimal paper / monthly invoices
  // Protect with EXPORT_TOKEN header: x-export-token
  function requireExportToken(req: Request, res: Response): boolean {
    const expected = process.env.EXPORT_TOKEN;
    if (!expected) {
      sendApiError(res, 503, {
        code: "exports_not_configured",
        reason: "exports_not_configured",
      });
      return false;
    }
    const provided = req.headers["x-export-token"] as string | string[] | undefined;
    const normalizedProvided = Array.isArray(provided) ? provided[0] : provided;
    if (!normalizedProvided || normalizedProvided !== expected) {
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
          return sendCheckoutError(res, 400, {
            code: "INVALID_CHECKOUT_REQUEST",
            message: "Některá položka košíku je neplatná.",
            details: { productId: item.productId },
          });
        }

        const unitPriceCzk = Number(product.price) || 0;
        if (unitPriceCzk <= 0) {
          return sendCheckoutError(res, 400, {
            code: "INVALID_CHECKOUT_REQUEST",
            message: "Některá položka košíku má neplatnou cenu.",
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
    const requestId = req.requestId || "unknown";
    const route = "/api/checkout/create-session";

    try {
      const stripe = await getUncachableStripeClient().catch(() => null);
      if (!stripe) {
        checkoutLog({ requestId, route, result: "fail", code: "STRIPE_CONFIG_ERROR" });
        return sendCheckoutError(res, 500, {
          code: "STRIPE_CONFIG_ERROR",
          message: "Platba je dočasně nedostupná.",
        });
      }

      const parsed = CreateSessionSchema.parse(req.body);
      const customerDetails = resolveCustomerDetails(parsed);
      const missingCustomerFields = Object.entries(customerDetails)
        .filter(([, value]) => !String(value || "").trim())
        .map(([key]) => key);
      if (missingCustomerFields.length > 0) {
        return sendCheckoutError(res, 400, {
          code: "INVALID_CHECKOUT_REQUEST",
          message: "Vyplň prosím kontaktní a doručovací údaje.",
          details: { missing: missingCustomerFields },
        });
      }

      // If user selected crypto, we currently don't route through Stripe.
      const pm = (parsed.paymentMethod || "card") as PaymentMethod;
      const paymentCheck = validatePaymentForShipping(parsed.shippingMethod as ShippingMethodId, pm);
      if (!paymentCheck.ok) {
        return sendCheckoutError(res, 400, {
          code: "INVALID_CHECKOUT_REQUEST",
          message: "Zkontroluj dopravu/platbu a zkus to znovu.",
          details: {
            shippingMethod: parsed.shippingMethod,
            paymentMethod: pm,
          },
        });
      }
      // This endpoint only supports Stripe-based methods.
      if (pm !== "card" && pm !== "gpay" && pm !== "applepay") {
        return sendCheckoutError(res, 400, {
          code: "INVALID_CHECKOUT_REQUEST",
          message: "Zkontroluj dopravu/platbu a zkus to znovu.",
          details: {
            shippingMethod: parsed.shippingMethod,
            paymentMethod: pm,
          },
        });
      }

      // Server builds line items from DB (never trust client price)
      const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      const fingerprintItems: Array<{ productId: string; quantity: number; unitPrice: number; size?: string | null }> = [];
      let subtotalCzk = 0;

      for (const item of parsed.items) {
        const product = await storage.getProduct(item.productId);
        if (!product) {
          return sendCheckoutError(res, 400, {
            code: "INVALID_CHECKOUT_REQUEST",
            message: "Některá položka košíku je neplatná.",
            details: { productId: item.productId },
          });
        }

        const unitPriceCzk = Number(product.price) || 0;
        if (unitPriceCzk <= 0) {
          return sendCheckoutError(res, 400, {
            code: "INVALID_CHECKOUT_REQUEST",
            message: "Některá položka košíku má neplatnou cenu.",
            details: { productId: product.id },
          });
        }

        fingerprintItems.push({
          productId: item.productId,
          quantity: item.quantity,
          size: item.size,
          unitPrice: unitPriceCzk,
        });

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
        return sendCheckoutError(res, 400, {
          code: "INVALID_CHECKOUT_REQUEST",
          message: "Zvolený způsob dopravy není podporovaný.",
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
        return sendCheckoutError(res, 400, {
          code: "INVALID_CHECKOUT_REQUEST",
          message: "Objednávka nedosahuje minimální částky pro platbu.",
          details: { totalCzk },
        });
      }

      const idempotencyKey = parsed.idempotencyKey;
      if ((parsed.currency || "czk").toLowerCase() !== "czk") {
        return sendCheckoutError(res, 400, {
          code: "INVALID_CHECKOUT_REQUEST",
          message: "Měna objednávky musí být CZK.",
        });
      }
      const fingerprint = buildOrderFingerprint({
        items: fingerprintItems,
        shippingMethod: parsed.shippingMethod,
        paymentMethod: pm,
        customerEmail: customerDetails.customerEmail,
        totalAmount: totalCzk,
        currency: "czk",
      });

      // ✅ Create order in DB FIRST (pending/unpaid) with idempotency + fingerprint guard
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
        paymentProvider: "stripe",
        fingerprint,
        fingerprintCreatedAt: new Date(),
        // userId is optional (guest checkout)
        userId: null as any,
      };

      const { order, idempotencyHit, fingerprintHit } = await createOrderWithIdempotency({
        idempotencyKey,
        paymentMethod: pm,
        values: orderValues,
        fingerprint,
      });

      if (!order) {
        checkoutLog({ requestId, route, result: "fail", code: "ORDER_STATE_CONFLICT" });
        return res.status(409).json({
          code: "ORDER_STATE_CONFLICT",
          conflictState: "processing",
          message: "Objednávka je právě zpracovávaná. Zkus to prosím znovu.",
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
        checkoutLog({ requestId, route, result: "fail", code: "STRIPE_CONFIG_ERROR" });
        return sendCheckoutError(res, 500, {
          code: "STRIPE_CONFIG_ERROR",
          message: "Platba je dočasně nedostupná.",
        });
      }

      console.log(`[checkout] create-session order=${order.id} status=${order.status} paymentStatus=${order.paymentStatus}`);

      if (order.status === "cancelled") {
        console.warn(`[checkout] blocked cancelled order=${order.id}`);
        checkoutLog({
          requestId,
          route,
          orderId: order.id,
          fingerprint: fingerprint.slice(0, 16),
          result: "fail",
          code: "ORDER_CANCELLED",
        });
        return res.status(409).json({
          code: "ORDER_CANCELLED",
          message: "Předchozí checkout už není aktivní. Spusť prosím nový pokus.",
          orderId: order.id,
          restartCheckout: true,
        });
      }

      if (order.paymentStatus === "paid" || order.status === "confirmed" || order.status === "fulfilled") {
        console.warn(`[checkout] blocked already paid order=${order.id}`);
        checkoutLog({
          requestId,
          route,
          orderId: order.id,
          fingerprint: fingerprint.slice(0, 16),
          result: "fail",
          code: "ORDER_STATE_CONFLICT",
        });
        return res.status(409).json({
          code: "ORDER_STATE_CONFLICT",
          conflictState: "already_paid",
          message: "Objednávka už byla zaplacená nebo zpracovaná.",
          orderId: order.id,
          redirectUrl: `${baseUrl}/success?order_id=${encodeURIComponent(order.id)}`,
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
        checkoutLog({
          requestId,
          route,
          orderId: order.id,
          fingerprint: fingerprint.slice(0, 16),
          result: "fail",
          code: "STRIPE_CONFIG_ERROR",
        });
        return sendCheckoutError(res, 500, {
          code: "STRIPE_CONFIG_ERROR",
          message: "Platba je dočasně nedostupná.",
        });
      }

      const SESSION_RECOVERY_COOLDOWN_MS = 2 * 60 * 1000;

      let session: Stripe.Checkout.Session;
      try {
        session = await db.transaction(async (tx) => {
          const lockResult = await tx.execute(sql<{ id: string; status: string; payment_status: string | null; stripe_checkout_session_id: string | null; stripe_checkout_session_created_at: string | Date | null }>`
            SELECT id, status, payment_status, stripe_checkout_session_id, stripe_checkout_session_created_at
            FROM orders
            WHERE id = ${order.id}
            FOR UPDATE
          `);

          const lockedOrder = lockResult.rows?.[0];

          if (!lockedOrder) {
            throw new Error("order_not_found");
          }

          if (
            lockedOrder.status === "cancelled"
          ) {
            throw new Error("ORDER_CANCELLED");
          }

          if (
            lockedOrder.payment_status === "paid" ||
            lockedOrder.status === "confirmed" ||
            lockedOrder.status === "fulfilled"
          ) {
            console.warn(`[checkout] blocked already paid order=${order.id}`);
            throw new Error("ORDER_ALREADY_PAID");
          }

          if (lockedOrder.stripe_checkout_session_id) {
            let shouldRecoverSession = false;
            try {
              const existingSession = await stripe.checkout.sessions.retrieve(String(lockedOrder.stripe_checkout_session_id));
              const canReuseExistingSession =
                existingSession.status === "open" &&
                Boolean(existingSession.url) &&
                existingSession.payment_status !== "paid";

              if (canReuseExistingSession && existingSession.url) {
                console.info("stripe_session_reuse_ok", {
                  orderId: order.id,
                  stripeCheckoutSessionId: lockedOrder.stripe_checkout_session_id,
                  stripeStatus: existingSession.status,
                  stripePaymentStatus: existingSession.payment_status,
                });
                return existingSession;
              }

              console.info("stripe_session_reuse_recreate", {
                orderId: order.id,
                stripeCheckoutSessionId: lockedOrder.stripe_checkout_session_id,
                stripeStatus: existingSession.status,
                stripePaymentStatus: existingSession.payment_status,
                hasUrl: Boolean(existingSession.url),
              });

              if (existingSession.status === "open") {
                try {
                  await stripe.checkout.sessions.expire(String(existingSession.id));
                  console.info("stripe_session_recreate_expire_old_session_ok", {
                    orderId: order.id,
                    oldSessionId: existingSession.id,
                  });
                } catch (expireError: any) {
                  console.warn("stripe_session_recreate_expire_old_session_failed", {
                    orderId: order.id,
                    oldSessionId: existingSession.id,
                    error: expireError?.message || "unknown_error",
                  });
                }
              }

              shouldRecoverSession = true;
            } catch (retrieveError) {
              console.warn("[checkout] failed to retrieve existing stripe session", {
                orderId: order.id,
                stripeCheckoutSessionId: lockedOrder.stripe_checkout_session_id,
                error: (retrieveError as any)?.message,
              });
              shouldRecoverSession = true;
            }

            if (shouldRecoverSession) {
              const createdAtMs = lockedOrder.stripe_checkout_session_created_at
                ? new Date(String(lockedOrder.stripe_checkout_session_created_at)).getTime()
                : null;
              const ageMs = createdAtMs ? Date.now() - createdAtMs : null;
              if (ageMs !== null && ageMs < SESSION_RECOVERY_COOLDOWN_MS) {
                console.info("stripe_session_recreate_throttled", {
                  orderId: order.id,
                  stripeCheckoutSessionId: lockedOrder.stripe_checkout_session_id,
                  age_ms: ageMs,
                });
                throw new Error("SESSION_RETRY_LATER");
              }

              const recreatedSession = await stripe.checkout.sessions.create(
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
                  idempotencyKey: buildStripeIdempotencyKey(order.id, fingerprint, 1),
                }
              );

              await tx
                .update(orders)
                .set({
                  stripeCheckoutSessionId: recreatedSession.id,
                  stripeCheckoutSessionCreatedAt: new Date(),
                })
                .where(eq(orders.id, order.id));

              await tx
                .update(orderIdempotencyKeys)
                .set({
                  stripeSessionId: recreatedSession.id,
                  stripeSessionUrl: recreatedSession.url,
                  updatedAt: new Date(),
                })
                .where(eq(orderIdempotencyKeys.idempotencyKey, idempotencyKey));

              console.info("stripe_session_recreate_unusable", {
                orderId: order.id,
                oldSessionId: lockedOrder.stripe_checkout_session_id,
                newSessionId: recreatedSession.id,
              });

              return recreatedSession;
            }

            throw new Error("SESSION_ALREADY_CREATED");
          }

          const createdSession = await stripe.checkout.sessions.create(
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
              idempotencyKey: buildStripeIdempotencyKey(order.id, fingerprint, 0),
            }
          );

          await tx
            .update(orders)
            .set({
              stripeCheckoutSessionId: createdSession.id,
              stripeCheckoutSessionCreatedAt: new Date(),
            })
            .where(eq(orders.id, order.id));

          await tx
            .update(orderIdempotencyKeys)
            .set({
              stripeSessionId: createdSession.id,
              stripeSessionUrl: createdSession.url,
              updatedAt: new Date(),
            })
            .where(eq(orderIdempotencyKeys.idempotencyKey, idempotencyKey));

          return createdSession;
        });
      } catch (e: any) {
        if (e?.message === "ORDER_CANCELLED") {
          checkoutLog({
            requestId,
            route,
            orderId: order.id,
            fingerprint: fingerprint.slice(0, 16),
            result: "fail",
            code: "ORDER_CANCELLED",
          });
          return res.status(409).json({
            code: "ORDER_CANCELLED",
            message: "Předchozí checkout už není aktivní. Spusť prosím nový pokus.",
            orderId: order.id,
            restartCheckout: true,
          });
        }

        if (e?.message === "ORDER_ALREADY_PAID" || e?.message === "SESSION_ALREADY_CREATED" || e?.message === "SESSION_RETRY_LATER") {
          checkoutLog({
            requestId,
            route,
            orderId: order.id,
            fingerprint: fingerprint.slice(0, 16),
            result: "fail",
            code: "ORDER_STATE_CONFLICT",
          });
          return res.status(409).json({
            code: "ORDER_STATE_CONFLICT",
            conflictState: e?.message === "ORDER_ALREADY_PAID" ? "already_paid" : "processing",
            message:
              e?.message === "ORDER_ALREADY_PAID"
                ? "Objednávka už byla zaplacená nebo zpracovaná."
                : "Checkout už běží nebo se ještě zpracovává. Počkej prosím chvíli a zkus to znovu.",
            orderId: order.id,
          });
        }
        // Prevent orphan orders only for newly-created orders if Stripe session creation fails
        if (!idempotencyHit && !fingerprintHit) {
          try {
            await storage.updateOrder(order.id, { status: "cancelled", paymentStatus: "unpaid" });
          } catch (updateErr) {
            console.error("[checkout] failed to cancel order after Stripe error:", {
              orderId: order.id,
              error: (updateErr as any)?.message,
            });
          }
        }
        throw e;
      }

      if (!session.url) {
        checkoutLog({
          requestId,
          route,
          orderId: order.id,
          fingerprint: fingerprint.slice(0, 16),
          result: "fail",
          code: "STRIPE_INVALID_PARAMS",
        });
        return sendCheckoutError(res, 400, {
          code: "STRIPE_INVALID_PARAMS",
          message: "Neplatné parametry platby.",
        });
      }

      checkoutLog({
        requestId,
        route,
        orderId: order.id,
        fingerprint: fingerprint.slice(0, 16),
        result: "ok",
        code: "OK",
      });
      return res.json({ url: session.url, orderId: order.id, accessToken: order.accessToken });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        checkoutLog({ requestId, route, result: "fail", code: "INVALID_CHECKOUT_REQUEST" });
        return sendCheckoutError(res, 400, {
          code: "INVALID_CHECKOUT_REQUEST",
          message: "Zkontroluj objednávku a zkus to znovu.",
          details: err.flatten(),
        });
      }

      const mappedStripeError = mapStripeError(err);
      if (mappedStripeError) {
        checkoutLog({
          requestId,
          route,
          result: "fail",
          code: mappedStripeError.code,
          stripeRequestId: mappedStripeError.stripeRequestId,
        });
        return sendCheckoutError(res, mappedStripeError.status, {
          code: mappedStripeError.code,
          message: mappedStripeError.message,
        });
      }

      console.error("[checkout] create-session failed", {
        requestId,
        route,
        code: "CHECKOUT_INTERNAL_ERROR",
        message: err?.message || "unknown_error",
      });
      checkoutLog({ requestId, route, result: "fail", code: "CHECKOUT_INTERNAL_ERROR" });
      return sendCheckoutError(res, 500, {
        code: "CHECKOUT_INTERNAL_ERROR",
        message: "Platbu se nepodařilo vytvořit. Zkus to prosím za chvíli.",
      });
    }
  });

  // ✅ Dobírka (COD): create DB order without Stripe
  app.post("/api/checkout/create-cod-order", async (req, res) => {
    try {
      const parsed = CreateCodOrderSchema.parse(req.body);
      const customerDetails = resolveCustomerDetails(parsed);
      const missingCustomerFields = Object.entries(customerDetails)
        .filter(([, value]) => !String(value || "").trim())
        .map(([key]) => key);
      if (missingCustomerFields.length > 0) {
        return sendCheckoutError(res, 400, {
          code: "INVALID_CHECKOUT_REQUEST",
          message: "Vyplň prosím kontaktní a doručovací údaje.",
          details: { missing: missingCustomerFields },
        });
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
          return sendCheckoutError(res, 400, {
            code: "INVALID_CHECKOUT_REQUEST",
            message: "Některá položka košíku je neplatná.",
            details: { productId: item.productId },
          });
        }

        const unitPriceCzk = Number(product.price) || 0;
        if (unitPriceCzk <= 0) {
          return sendCheckoutError(res, 400, {
            code: "INVALID_CHECKOUT_REQUEST",
            message: "Některá položka košíku má neplatnou cenu.",
            details: { productId: product.id },
          });
        }

        subtotalCzk += unitPriceCzk * item.quantity;
      }

      const shipping = SHIPPING_METHODS[parsed.shippingMethod as ShippingMethodId];
      if (!shipping) {
        return sendCheckoutError(res, 400, {
          code: "INVALID_CHECKOUT_REQUEST",
          message: "Zvolený způsob dopravy není podporovaný.",
        });
      }

      const totals = calculateTotals({
        subtotalCzk,
        shippingId: parsed.shippingMethod as ShippingMethodId,
        paymentMethod: "cod",
      });

      const totalCzk = totals.totalCzk;
      if (totalCzk < 15) {
        return sendCheckoutError(res, 400, {
          code: "INVALID_CHECKOUT_REQUEST",
          message: "Objednávka nedosahuje minimální částky pro platbu.",
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
        const stockResult = await deductStockOnceWithOrderLock(order.id, parsed.items as any);
        if (!stockResult.success) {
          // If stock deduction fails, cancel the order to avoid phantom reservations
          await storage.updateOrder(order.id, {
            status: "cancelled",
            paymentStatus: "unpaid",
          });
          console.error("[cod] stock deduction failed; order cancelled", {
            orderId: order.id,
            failures: stockResult.failures,
          });
          return sendApiError(res, 409, {
            code: "out_of_stock_or_reservation_failed",
            reason: "out_of_stock_or_reservation_failed",
            details: { orderId: order.id },
          });
        }

        // Mark COD order as confirmed (stock reserved) but unpaid
        await storage.updateOrder(order.id, {
          status: "confirmed",
          paymentStatus: "unpaid",
        });
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
      const missingCustomerFields = Object.entries(customerDetails)
        .filter(([, value]) => !String(value || "").trim())
        .map(([key]) => key);
      if (missingCustomerFields.length > 0) {
        return sendCheckoutError(res, 400, {
          code: "INVALID_CHECKOUT_REQUEST",
          message: "Vyplň prosím kontaktní a doručovací údaje.",
          details: { missing: missingCustomerFields },
        });
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
          return sendCheckoutError(res, 400, {
            code: "INVALID_CHECKOUT_REQUEST",
            message: "Některá položka košíku je neplatná.",
            details: { productId: item.productId },
          });
        }

        const unitPriceCzk = Number(product.price) || 0;
        if (unitPriceCzk <= 0) {
          return sendCheckoutError(res, 400, {
            code: "INVALID_CHECKOUT_REQUEST",
            message: "Některá položka košíku má neplatnou cenu.",
            details: { productId: product.id },
          });
        }

        subtotalCzk += unitPriceCzk * item.quantity;
      }

      const shipping = SHIPPING_METHODS[parsed.shippingMethod as ShippingMethodId];
      if (!shipping) {
        return sendCheckoutError(res, 400, {
          code: "INVALID_CHECKOUT_REQUEST",
          message: "Zvolený způsob dopravy není podporovaný.",
        });
      }

      const totals = calculateTotals({
        subtotalCzk,
        shippingId: parsed.shippingMethod as ShippingMethodId,
        paymentMethod: "card",
      });

      const totalCzk = totals.totalCzk;
      if (totalCzk < 15) {
        return sendCheckoutError(res, 400, {
          code: "INVALID_CHECKOUT_REQUEST",
          message: "Objednávka nedosahuje minimální částky pro platbu.",
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
        const stockResult = await deductStockOnceWithOrderLock(order.id, parsed.items as any);
        if (!stockResult.success) {
          await storage.updateOrder(order.id, {
            status: "cancelled",
            paymentStatus: "unpaid",
          });
          console.error("[in-person] stock deduction failed; order cancelled", {
            orderId: order.id,
            failures: stockResult.failures,
          });
          return sendApiError(res, 409, {
            code: "out_of_stock_or_reservation_failed",
            reason: "out_of_stock_or_reservation_failed",
            details: { orderId: order.id },
          });
        }

        await storage.updateOrder(order.id, {
          status: "confirmed",
          paymentStatus: "unpaid",
        });
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


  app.post("/api/checkout/create-bank-order", async (req, res) => {
    try {
      const parsed = CreateSessionSchema.parse(req.body);
      const customerDetails = resolveCustomerDetails(parsed);
      const pm = (parsed.paymentMethod || "bank") as PaymentMethod;
      if (pm !== "bank") {
        return sendApiError(res, 400, { code: "invalid_payment_method", reason: "invalid_payment_method" });
      }

      const paymentCheck = validatePaymentForShipping(parsed.shippingMethod as ShippingMethodId, pm);
      if (!paymentCheck.ok) {
        return sendApiError(res, 400, { code: paymentCheck.code, reason: paymentCheck.reason });
      }

      let subtotalCzk = 0;
      for (const item of parsed.items) {
        const product = await storage.getProduct(item.productId);
        if (!product) return sendApiError(res, 400, { code: "invalid_product", reason: "invalid_product" });
        subtotalCzk += Number(product.price) * item.quantity;
      }

      const shipping = SHIPPING_METHODS[parsed.shippingMethod as ShippingMethodId];
      const totals = calculateTotals({ subtotalCzk, shippingId: parsed.shippingMethod as ShippingMethodId, paymentMethod: pm });
      const dueDays = Math.max(1, Number(env.BANK_TRANSFER_DUE_DAYS || 3));
      const generatedExpiresAt = new Date(Date.now() + dueDays * 24 * 60 * 60 * 1000);
      const generatedReference = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

      const { order } = await createOrderWithIdempotency({
        idempotencyKey: parsed.idempotencyKey,
        paymentMethod: pm,
        values: {
          accessToken: generateOrderAccessToken(),
          customerName: customerDetails.customerName,
          customerEmail: customerDetails.customerEmail,
          customerAddress: customerDetails.customerAddress,
          customerCity: customerDetails.customerCity,
          customerZip: customerDetails.customerZip,
          items: JSON.stringify({ items: parsed.items, shippingMethod: parsed.shippingMethod, shippingLabel: shipping.label, subtotalCzk, shippingCzk: shipping.priceCzk, totalCzk: totals.totalCzk }),
          total: Math.round(totals.totalCzk),
          paymentMethod: pm,
          paymentProvider: "bank_transfer",
          providerReference: generatedReference,
          providerStatus: "pending",
          bankTransferExpiresAt: generatedExpiresAt,
          userId: null as any,
        },
      });

      const persistedReference = order.providerReference || generatedReference;
      const persistedExpiresAt = order.bankTransferExpiresAt || generatedExpiresAt;
      const patch: Partial<Order> = {
        paymentProvider: "bank_transfer",
        paymentStatus: order.paymentStatus === "paid" ? "paid" : "pending",
        status: order.paymentStatus === "paid" ? order.status : "pending",
      };

      if (!order.providerReference) {
        patch.providerReference = persistedReference;
      }
      if (!order.bankTransferExpiresAt) {
        patch.bankTransferExpiresAt = persistedExpiresAt;
      }
      if (!order.providerStatus) {
        patch.providerStatus = "pending";
      }

      if (Object.keys(patch).length > 0) {
        await storage.updateOrder(order.id, patch);
      }

      const persistedOrder = await storage.getOrder(order.id);
      if (!persistedOrder?.providerReference) {
        return sendApiError(res, 500, { code: "bank_reference_not_persisted", reason: "bank_reference_not_persisted" });
      }

      if (order.providerReference) {
        console.info("bank_transfer_reference_reused", { orderId: order.id, reference: order.providerReference });
      } else {
        console.info("bank_transfer_created", { orderId: order.id, reference: persistedOrder.providerReference });
      }

      const pendingEmailEvent = await db
        .insert(orderEvents)
        .values({
          orderId: persistedOrder.id,
          provider: "system",
          providerEventId: `email_bank_pending:${persistedOrder.id}`,
          type: "email_bank_pending_sent",
          payload: { source: "checkout:create-bank-order" },
        })
        .onConflictDoNothing()
        .returning({ id: orderEvents.id });

      if (pendingEmailEvent.length > 0) {
        sendBankTransferPendingEmail(persistedOrder as any).catch((err) =>
          console.error("[bank] Failed to send pending bank transfer email:", err)
        );
      }

      return res.json({
        success: true,
        orderId: persistedOrder.id,
        instructions: {
          accountNumber: env.BANK_ACCOUNT_NUMBER || null,
          bankCode: env.BANK_CODE || null,
          iban: env.BANK_IBAN || null,
          accountName: env.BANK_ACCOUNT_NAME || null,
          amount: totals.totalCzk,
          reference: persistedOrder.providerReference ?? String(persistedOrder.id),
          expiresAt: persistedOrder.bankTransferExpiresAt,
        },
      });
    } catch (err: any) {
      return sendApiError(res, 500, { code: "bank_order_failed", reason: "bank_order_failed", details: { message: err?.message || "unknown" } });
    }
  });

  app.post("/api/checkout/create-coingate-order", async (req, res) => {
    try {
      const parsed = CreateSessionSchema.parse(req.body);
      const customerDetails = resolveCustomerDetails(parsed);
      const pm = (parsed.paymentMethod || "btc") as PaymentMethod;
      if (!["btc", "eth", "usdc", "sol"].includes(pm)) {
        return sendApiError(res, 400, { code: "invalid_payment_method", reason: "invalid_payment_method" });
      }

      const paymentCheck = validatePaymentForShipping(parsed.shippingMethod as ShippingMethodId, pm);
      if (!paymentCheck.ok) {
        return sendApiError(res, 400, { code: paymentCheck.code, reason: paymentCheck.reason });
      }

      let subtotalCzk = 0;
      for (const item of parsed.items) {
        const product = await storage.getProduct(item.productId);
        if (!product) return sendApiError(res, 400, { code: "invalid_product", reason: "invalid_product" });
        subtotalCzk += Number(product.price) * item.quantity;
      }

      const shipping = SHIPPING_METHODS[parsed.shippingMethod as ShippingMethodId];
      const totals = calculateTotals({ subtotalCzk, shippingId: parsed.shippingMethod as ShippingMethodId, paymentMethod: pm });

      const { order } = await createOrderWithIdempotency({
        idempotencyKey: parsed.idempotencyKey,
        paymentMethod: pm,
        values: {
          accessToken: generateOrderAccessToken(),
          customerName: customerDetails.customerName,
          customerEmail: customerDetails.customerEmail,
          customerAddress: customerDetails.customerAddress,
          customerCity: customerDetails.customerCity,
          customerZip: customerDetails.customerZip,
          items: JSON.stringify({ items: parsed.items, shippingMethod: parsed.shippingMethod, shippingLabel: shipping.label, subtotalCzk, shippingCzk: shipping.priceCzk, totalCzk: totals.totalCzk }),
          total: Math.round(totals.totalCzk),
          paymentMethod: pm,
          paymentProvider: "coingate",
          providerStatus: "pending",
          userId: null as any,
        },
      });

      if (order.status === "cancelled") {
        return sendApiError(res, 409, { code: "order_cancelled", reason: "order_cancelled" });
      }

      const isFinalized = order.paymentStatus === "paid" && ["confirmed", "fulfilled"].includes(String(order.status || ""));
      if (isFinalized && order.providerPaymentUrl) {
        return res.json({ success: true, orderId: order.id, redirectUrl: order.providerPaymentUrl, reused: true });
      }

      if (order.paymentProvider === "coingate" && order.providerOrderId && order.providerPaymentUrl && !isFinalized) {
        console.info("coingate_order_reused", { orderId: order.id, providerOrderId: order.providerOrderId });
        await storage.updateOrder(order.id, {
          paymentProvider: "coingate",
          paymentStatus: order.paymentStatus === "paid" ? "paid" : "pending",
          status: order.paymentStatus === "paid" ? order.status : "pending",
        });

        const persistedReuseOrder = await storage.getOrder(order.id);
        if (!persistedReuseOrder?.providerPaymentUrl) {
          return sendApiError(res, 500, { code: "coingate_reuse_state_missing", reason: "coingate_reuse_state_missing" });
        }

        return res.json({
          success: true,
          orderId: persistedReuseOrder.id,
          redirectUrl: persistedReuseOrder.providerPaymentUrl,
          reused: true,
        });
      }

      const providerOrder = await createCoinGateOrder({
        orderId: order.id,
        amountCzk: totals.totalCzk,
        receiveCurrency: pm.toUpperCase() as any,
      });

      await storage.updateOrder(order.id, {
        paymentProvider: "coingate",
        paymentStatus: "pending",
        status: "pending",
        providerOrderId: String(providerOrder.id),
        providerPaymentUrl: providerOrder.payment_url,
        providerStatus: providerOrder.status,
      });

      const persistedOrder = await storage.getOrder(order.id);
      if (!persistedOrder?.providerOrderId || !persistedOrder.providerPaymentUrl) {
        return sendApiError(res, 500, { code: "coingate_state_not_persisted", reason: "coingate_state_not_persisted" });
      }

      console.info("coingate_order_created", { orderId: persistedOrder.id, providerOrderId: persistedOrder.providerOrderId });
      return res.json({
        success: true,
        orderId: persistedOrder.id,
        redirectUrl: persistedOrder.providerPaymentUrl,
        reused: false,
      });
    } catch (err: any) {
      return sendApiError(res, 500, { code: "coingate_order_failed", reason: "coingate_order_failed", details: { message: err?.message || "unknown" } });
    }
  });

  app.get("/api/checkout/coingate/verify/:orderId", async (req, res) => {
    try {
      const orderId = String(req.params.orderId || "");
      const order = await storage.getOrder(orderId);
      if (!order) return sendApiError(res, 404, { code: "order_not_found", reason: "order_not_found" });
      if (order.paymentProvider !== "coingate") return sendApiError(res, 400, { code: "invalid_provider", reason: "invalid_provider" });
      if (!order.providerOrderId) return sendApiError(res, 400, { code: "missing_provider_order", reason: "missing_provider_order" });

      const providerOrder = await retrieveCoinGateOrder(order.providerOrderId);
      const mapped = mapCoinGateStatus(providerOrder.status);
      await storage.updateOrder(order.id, { providerStatus: providerOrder.status });

      const latestOrder = await storage.getOrder(order.id);
      const alreadyFinalized = Boolean(
        latestOrder && latestOrder.paymentStatus === "paid" && ["confirmed", "fulfilled"].includes(String(latestOrder.status || ""))
      );

      if (mapped === "paid") {
        if (alreadyFinalized) {
          console.info("coingate_paid_already_finalized", { orderId: order.id, providerOrderId: order.providerOrderId });
          return res.json({ success: true, state: "paid", orderId: order.id });
        }

        await storage.updateOrder(order.id, {
          paymentStatus: "paid",
          status: "confirmed",
          paidAt: new Date(),
          paymentConfirmedAt: new Date(),
          providerStatus: providerOrder.status,
        });

        const finalize = await finalizePaidOrder({
          orderId: order.id,
          provider: "coingate",
          providerEventId: `verify:${providerOrder.id}`,
          meta: { source: "coingate-verify", reconcileRecovery: true },
        });

        await db.insert(auditLog).values({
          action: "coingate_paid_reconcile_recovery",
          entity: "order",
          entityId: order.id,
          severity: "info",
          meta: { source: "verify", providerOrderId: providerOrder.id, finalizeSkipped: finalize.skipped },
        });
        console.info("coingate_paid_reconcile_recovery", { orderId: order.id, providerOrderId: providerOrder.id, finalizeSkipped: finalize.skipped });

        const finalizedOrder = await storage.getOrder(order.id);
        const isFinalizedNow = Boolean(
          finalizedOrder && finalizedOrder.paymentStatus === "paid" && ["confirmed", "fulfilled"].includes(String(finalizedOrder.status || ""))
        );

        if (!isFinalizedNow || !finalize.success) {
          return res.json({ success: false, state: "paid_unreconciled", orderId: order.id });
        }

        return res.json({ success: true, state: "paid", orderId: order.id });
      }

      if (mapped === "pending") {
        return res.json({ success: false, state: "pending", orderId: order.id });
      }

      if (mapped === "expired" || mapped === "canceled") {
        return res.json({ success: false, state: mapped, orderId: order.id });
      }

      return res.json({ success: false, state: "failed", orderId: order.id });
    } catch (err: any) {
      return sendApiError(res, 500, { code: "coingate_verify_failed", reason: "coingate_verify_failed", details: { message: err?.message || "unknown" } });
    }
  });

  app.post("/api/coingate/webhook", async (req, res) => {
    try {
      const providerOrderId = String(req.body?.id || req.body?.order_id || "");
      const providerStatusRaw = String(req.body?.status || "pending");
      const mapped = mapCoinGateStatus(providerStatusRaw);

      console.info("coingate_webhook_receipt", {
        providerOrderId: providerOrderId || null,
        providerStatusRaw,
        mapped,
      });

      if (!env.COINGATE_WEBHOOK_SECRET) {
        console.error("coingate_webhook_reject_missing_secret", {
          providerOrderId: providerOrderId || null,
          reason: "coingate_webhook_misconfigured",
        });
        return sendApiError(res, 500, { code: "coingate_webhook_misconfigured", reason: "coingate_webhook_misconfigured" });
      }

      const secret = req.header("x-coingate-secret");
      if (secret !== env.COINGATE_WEBHOOK_SECRET) {
        console.warn("coingate_webhook_reject_invalid_secret", {
          providerOrderId: providerOrderId || null,
        });
        return sendApiError(res, 401, { code: "invalid_webhook_secret", reason: "invalid_webhook_secret" });
      }

      console.info("coingate_webhook_auth_ok", { providerOrderId: providerOrderId || null });

      if (!providerOrderId) {
        console.warn("coingate_webhook_invalid_payload_missing_provider_order", {
          payloadKeys: Object.keys(req.body || {}),
        });
        return sendApiError(res, 400, { code: "missing_provider_order", reason: "missing_provider_order" });
      }

      const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.providerOrderId, providerOrderId), eq(orders.paymentProvider, "coingate")))
        .limit(1);

      if (!order) {
        console.warn("coingate_webhook_lookup_miss", { providerOrderId, providerStatusRaw, mapped });
        console.info("coingate_webhook_ack", { providerOrderId, ack: "lookup_miss_noop" });
        return res.json({ ok: true, skipped: "lookup_miss" });
      }

      if (order.status === "cancelled") {
        console.info("coingate_webhook_lookup_hit_cancelled", { orderId: order.id, providerOrderId });
        console.info("coingate_webhook_ack", { orderId: order.id, providerOrderId, ack: "cancelled_noop" });
        return res.json({ ok: true, skipped: "cancelled" });
      }

      await storage.updateOrder(order.id, { providerStatus: providerStatusRaw });
      console.info("coingate_webhook_status_mapped", {
        orderId: order.id,
        providerOrderId,
        providerStatusRaw,
        mapped,
      });

      if (mapped === "paid") {
        const latestOrder = await storage.getOrder(order.id);
        const alreadyFinalized = Boolean(
          latestOrder && latestOrder.paymentStatus === "paid" && ["confirmed", "fulfilled"].includes(String(latestOrder.status || ""))
        );

        if (alreadyFinalized) {
          console.info("coingate_paid_already_finalized", { orderId: order.id, providerOrderId });
          console.info("coingate_webhook_ack", { orderId: order.id, providerOrderId, ack: "already_finalized_noop" });
          return res.json({ ok: true, skipped: "already_finalized" });
        }

        await storage.updateOrder(order.id, {
          paymentStatus: "paid",
          status: "confirmed",
          paidAt: new Date(),
          paymentConfirmedAt: new Date(),
          providerStatus: providerStatusRaw,
        });

        const finalize = await finalizePaidOrder({
          orderId: order.id,
          provider: "coingate",
          providerEventId: `webhook:${providerOrderId}:${providerStatusRaw}`,
          meta: { source: "coingate-webhook", reconcileRecovery: true },
        });

        if (!finalize.success) {
          console.error("coingate_webhook_finalize_failed", {
            orderId: order.id,
            providerOrderId,
            error: finalize.error || "unknown",
          });
          return sendApiError(res, 500, { code: "coingate_finalize_failed", reason: "coingate_finalize_failed" });
        }

        await db.insert(auditLog).values({
          action: "coingate_paid_reconcile_recovery",
          entity: "order",
          entityId: order.id,
          severity: "info",
          meta: { source: "webhook", providerOrderId, finalizeSkipped: finalize.skipped },
        });
        console.info("coingate_paid_reconcile_recovery", { orderId: order.id, providerOrderId, finalizeSkipped: finalize.skipped });
        console.info("coingate_webhook_ack", { orderId: order.id, providerOrderId, ack: "paid_finalized" });
        return res.json({ ok: true, state: "paid" });
      }

      if (mapped === "pending" || mapped === "expired" || mapped === "canceled") {
        console.info("coingate_webhook_ack", {
          orderId: order.id,
          providerOrderId,
          ack: `status_${mapped}_noop`,
        });
        return res.json({ ok: true, skipped: mapped });
      }

      console.warn("coingate_webhook_invalid_status", {
        orderId: order.id,
        providerOrderId,
        providerStatusRaw,
      });
      console.info("coingate_webhook_ack", { orderId: order.id, providerOrderId, ack: "invalid_status_noop" });
      return res.json({ ok: true, skipped: "invalid_status" });
    } catch (err: any) {
      console.error("coingate_webhook_failed", { message: err?.message || "unknown" });
      return sendApiError(res, 500, { code: "coingate_webhook_failed", reason: "coingate_webhook_failed", details: { message: err?.message || "unknown" } });
    }
  });

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
              stripeCheckoutSessionId: null,
              stripeCheckoutSessionCreatedAt: null,
            })
            .where(eq(orders.id, orderId));
        });
      } else {
        await storage.updateOrder(orderId, {
          status: "cancelled",
          paymentStatus: order.paymentStatus || "unpaid",
          stripeCheckoutSessionId: null,
          stripeCheckoutSessionCreatedAt: null,
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
      const isStripeLikeMethod = STRIPE_LIKE_PAYMENT_METHODS.has((order.paymentMethod || "card") as PaymentMethod);
      const isCoinGateMethod = ["btc", "eth", "usdc", "sol"].includes(String(order.paymentMethod || "").toLowerCase());
      const hasSafeFinalStatus = ["paid", "confirmed", "fulfilled"].includes(String(order.paymentStatus || order.status || "").toLowerCase())
        || ["confirmed", "fulfilled"].includes(String(order.status || "").toLowerCase());

      if (!hasValidToken && (isStripeLikeMethod || isCoinGateMethod) && !hasSafeFinalStatus) {
        return sendApiError(res, 403, {
          code: "order_summary_forbidden",
          reason: "order_summary_forbidden",
        });
      }

      const safePayload = {
        success: true,
        orderId: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        paymentProvider: (order as any).paymentProvider ?? null,
        providerStatus: (order as any).providerStatus ?? null,
        providerReference: (order as any).providerReference ?? null,
        bankTransferExpiresAt: (order as any).bankTransferExpiresAt ?? null,
        totalCzk: typeof (order as any).total === "number" ? (order as any).total : Number((order as any).total),
        shippingMethod: payload?.shippingMethod ?? null,
        shippingLabel: payload?.shippingLabel ?? null,
        shippingCzk: payload?.shippingCzk ?? null,
        codFeeCzk: payload?.codFeeCzk ?? null,
        codCzk: payload?.codCzk ?? null,
        subtotalCzk: payload?.subtotalCzk ?? null,
        bankInstructions:
          order.paymentMethod === "bank"
            ? {
                accountNumber: env.BANK_ACCOUNT_NUMBER || null,
                bankCode: env.BANK_CODE || null,
                iban: env.BANK_IBAN || null,
                accountName: env.BANK_ACCOUNT_NAME || null,
                amount: typeof (order as any).total === "number" ? (order as any).total : Number((order as any).total),
                reference: (order as any).providerReference ?? String(order.id),
                expiresAt: (order as any).bankTransferExpiresAt ?? null,
              }
            : null,
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

      const paymentStatus = session.payment_status;
      const authority = await resolveAuthoritativeStripeOrder(session);
      if (!authority.ok) {
        console.warn("[checkout] verify rejected session/order mismatch", {
          sessionId: authority.sessionId,
          orderIdFromMeta: authority.orderIdFromMeta,
          clientReferenceId: authority.clientReferenceId,
          mappedOrderId: authority.mappedOrderId,
          reason: authority.reason,
        });

        await db.insert(auditLog).values({
          action: "verify_session_rejected",
          entity: "order",
          entityId: authority.mappedOrderId || authority.orderIdFromMeta || authority.clientReferenceId || authority.sessionId,
          severity: "warning",
          meta: {
            reason: authority.reason,
            sessionId: authority.sessionId,
            orderIdFromMeta: authority.orderIdFromMeta,
            clientReferenceId: authority.clientReferenceId,
            mappedOrderId: authority.mappedOrderId,
          },
        });

        return res.json({
          success: false,
          reason: authority.reason,
        });
      }

      if (paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
        return res.json({
          success: false,
          reason: "not_paid",
          paymentStatus,
          orderId: authority.authoritativeOrderId,
          retryAfterMs: 2500,
        });
      }

      const orderIdFromAuthority = authority.authoritativeOrderId;
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;

      const existingOrder = await storage.getOrder(orderIdFromAuthority);
      const isAlreadyFinalized = Boolean(
        existingOrder &&
        existingOrder.paymentStatus === "paid" &&
        (existingOrder.status === "confirmed" || existingOrder.status === "fulfilled")
      );
      if (isAlreadyFinalized) {
        return res.json({
          success: true,
          orderId: orderIdFromAuthority,
          paymentStatus,
          amountTotalCzk: STRIPE_TO_CZK(session.amount_total),
          currency: session.currency,
        });
      }

      await storage.updateOrder(orderIdFromAuthority, {
        paymentStatus: "paid",
        status: "confirmed",
        paymentIntentId: paymentIntentId || null,
        paymentNetwork: null,
      });

      const dbOrder = await storage.getOrder(orderIdFromAuthority);
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
          const stockResult = await deductStockOnceWithOrderLock(orderIdFromAuthority, parsedItems as any);
          if (!stockResult.success) {
            await db
              .update(orders)
              .set({
                manualReview: true,
                opsNotes: `Stock deduction failed — possible oversell: ${stockResult.failures.join("; ")}`,
              })
              .where(eq(orders.id, orderIdFromAuthority));

            await db.insert(auditLog).values({
              action: "stock_deduction_failed",
              entity: "order",
              entityId: orderIdFromAuthority,
              severity: "important",
              meta: { failures: stockResult.failures },
            });

            emitOrderEvent(OpsEventType.STOCK_ISSUE, orderIdFromAuthority, {
              reason: stockResult.failures.join("; "),
            });
          }
        }
      }

      await finalizePaidOrder({
        orderId: orderIdFromAuthority,
        provider: "stripe",
        providerEventId: `verify:${session.id}`,
        meta: { source: "verify", sessionId: session.id },
      });

      const orderForEmail = await storage.getOrder(orderIdFromAuthority);
      if (orderForEmail) {
        console.log(`[verify] sending emails for order ${orderForEmail.id}`);

        const markEmailEventSent = async (type: "email_customer_sent" | "email_fulfillment_sent", providerEventId: string) => {
          const result = await db
            .insert(orderEvents)
            .values({
              orderId: orderForEmail.id,
              provider: "system",
              providerEventId,
              type,
              payload: { source: "stripe:verify", sessionId: session.id },
            })
            .onConflictDoNothing()
            .returning({ id: orderEvents.id });

          return result.length > 0;
        };

        const shouldSendFulfillment = await markEmailEventSent(
          "email_fulfillment_sent",
          `email_fulfillment:${orderForEmail.id}`,
        );
        if (shouldSendFulfillment) {
          sendFulfillmentNewOrderEmail(orderForEmail).catch((err) =>
            console.error("[verify] Failed to send fulfillment email:", err)
          );
        }

        const shouldSendCustomer =
          !orderForEmail.manualReview &&
          await markEmailEventSent("email_customer_sent", `email_customer:${orderForEmail.id}`);
        if (shouldSendCustomer) {
          sendOrderConfirmationEmail(orderForEmail).catch((err) =>
            console.error("[verify] Failed to send customer confirmation email:", err)
          );
        }
      }

      return res.json({
        success: true,
        orderId: orderIdFromAuthority,
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

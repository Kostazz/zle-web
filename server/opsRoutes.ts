import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "./db";
import { auditLog, ledgerEntries, orderEvents, orders } from "@shared/schema";
import { finalizePaidOrder } from "./paymentPipeline";
import { deductStockOnceWithOrderLock } from "./webhookHandlers";
import { sendFulfillmentNewOrderEmail, sendOrderConfirmationEmail } from "./emailService";

function requireOpsToken(req: Request, res: Response): boolean {
  const expected = process.env.OPS_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "ops_not_configured" });
    return false;
  }

  const provided = req.headers["x-ops-token"] as string | undefined;

  if (!provided || provided !== expected) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

function parseLimit(raw: unknown) {
  const limit = Number(raw);
  if (!Number.isFinite(limit)) return 50;
  return Math.min(200, Math.max(1, Math.floor(limit)));
}

function parseOffset(raw: unknown) {
  const offset = Number(raw);
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

function parseBool(raw: unknown) {
  if (raw === "true" || raw === true) return true;
  if (raw === "false" || raw === false) return false;
  return null;
}

function buildItemsPayload(order: typeof orders.$inferSelect) {
  let parsed: any = null;
  try {
    parsed = order.items ? JSON.parse(order.items) : null;
  } catch {
    parsed = null;
  }

  if (Array.isArray(parsed)) {
    return { items: parsed };
  }

  return {
    items: Array.isArray(parsed?.items) ? parsed.items : [],
    shippingMethod: parsed?.shippingMethod ?? null,
    shippingLabel: parsed?.shippingLabel ?? null,
    subtotalCzk: parsed?.subtotalCzk ?? null,
    shippingCzk: parsed?.shippingCzk ?? null,
    codCzk: parsed?.codCzk ?? null,
    totalCzk: parsed?.totalCzk ?? null,
  };
}

function isBankOrder(order: typeof orders.$inferSelect) {
  return order.paymentMethod === "bank" || order.paymentProvider === "bank_transfer";
}

function canMarkPaid(order: typeof orders.$inferSelect) {
  if (!isBankOrder(order)) return false;
  if (order.status === "cancelled") return false;
  if (order.paymentStatus === "paid" && ["confirmed", "fulfilled"].includes(String(order.status || ""))) return false;
  return true;
}

function canMarkExpired(order: typeof orders.$inferSelect) {
  if (!isBankOrder(order)) return false;
  if (order.status === "cancelled" || order.paymentStatus === "paid") return false;
  return true;
}

function getOpsActor(req: Request) {
  const raw = req.headers["x-ops-user"];
  if (!raw) return null;
  return String(raw).trim() || null;
}

async function markEmailEventSent(orderId: string, type: "email_customer_sent" | "email_fulfillment_sent", providerEventId: string) {
  const result = await db
    .insert(orderEvents)
    .values({
      orderId,
      provider: "system",
      providerEventId,
      type,
      payload: { source: "ops:manual-bank" },
    })
    .onConflictDoNothing()
    .returning({ id: orderEvents.id });

  return result.length > 0;
}


function parseOrderItemsForStock(order: typeof orders.$inferSelect) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(order.items || "[]");
  } catch {
    return { ok: false as const, code: "invalid_json", items: [] as any[] };
  }

  const candidate = Array.isArray(parsed) ? parsed : Array.isArray((parsed as any)?.items) ? (parsed as any).items : null;
  if (!Array.isArray(candidate)) {
    return { ok: false as const, code: "items_not_array", items: [] as any[] };
  }

  if (candidate.length === 0) {
    return { ok: false as const, code: "items_empty", items: [] as any[] };
  }

  const valid = candidate.every((item: any) =>
    item &&
    typeof item.productId === "string" &&
    item.productId.trim().length > 0 &&
    Number.isFinite(Number(item.quantity)) &&
    Number(item.quantity) > 0
  );

  if (!valid) {
    return { ok: false as const, code: "items_invalid_shape", items: [] as any[] };
  }

  return { ok: true as const, code: null, items: candidate as any[] };
}

async function isOrderFinalizationCompleted(orderId: string) {
  const [ledger] = await db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.dedupeKey, `sale-${orderId}`))
    .limit(1);

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return false;

  return Boolean(
    ledger &&
    order.paymentStatus === "paid" &&
    ["confirmed", "fulfilled"].includes(String(order.status || ""))
  );
}

export function registerOpsRoutes(app: Express) {
  app.get("/api/ops/summary", async (req, res) => {
    if (!requireOpsToken(req, res)) return;

    try {
      const [total, pending, confirmed, cancelled, paid, unpaid, cod, card, stockDeducted] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(orders),
        db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.status, "pending")),
        db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.status, "confirmed")),
        db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.status, "cancelled")),
        db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.paymentStatus, "paid")),
        db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.paymentStatus, "unpaid")),
        db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.paymentMethod, "cod")),
        db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.paymentMethod, "card")),
        db.select({ count: sql<number>`count(*)` })
          .from(orders)
          .where(sql`${orders.stockDeductedAt} is not null`),
      ]);

      return res.json({
        ok: true,
        counts: {
          total: total[0]?.count ?? 0,
          confirmed: confirmed[0]?.count ?? 0,
          pending: pending[0]?.count ?? 0,
          cancelled: cancelled[0]?.count ?? 0,
          paid: paid[0]?.count ?? 0,
          unpaid: unpaid[0]?.count ?? 0,
          cod: cod[0]?.count ?? 0,
          card: card[0]?.count ?? 0,
          stockDeducted: stockDeducted[0]?.count ?? 0,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: "ops_summary_failed", message: err?.message || "unknown" });
    }
  });

  app.get("/api/ops/orders", async (req, res) => {
    if (!requireOpsToken(req, res)) return;

    try {
      const limit = parseLimit(req.query.limit);
      const offset = parseOffset(req.query.offset);
      const sort = String(req.query.sort || "createdAt_desc");
      const status = req.query.status ? String(req.query.status) : null;
      const paymentStatus = req.query.paymentStatus ? String(req.query.paymentStatus) : null;
      const paymentMethod = req.query.paymentMethod ? String(req.query.paymentMethod) : null;
      const paymentProvider = req.query.paymentProvider ? String(req.query.paymentProvider) : null;
      const hasStockDeducted = parseBool(req.query.hasStockDeducted);
      const q = req.query.q ? String(req.query.q).trim() : "";

      const filters = [];

      if (status) filters.push(eq(orders.status, status));
      if (paymentStatus) filters.push(eq(orders.paymentStatus, paymentStatus));
      if (paymentMethod) filters.push(eq(orders.paymentMethod, paymentMethod));
      if (paymentProvider) filters.push(eq(orders.paymentProvider, paymentProvider));
      if (hasStockDeducted === true) filters.push(sql`${orders.stockDeductedAt} is not null`);
      if (hasStockDeducted === false) filters.push(sql`${orders.stockDeductedAt} is null`);

      if (q) {
        const like = `%${q}%`;
        filters.push(or(ilike(orders.id, like), ilike(orders.customerEmail, like), ilike(orders.customerName, like)));
      }

      const orderBy =
        sort === "createdAt_asc"
          ? asc(orders.createdAt)
          : sort === "total_desc"
            ? desc(orders.total)
            : desc(orders.createdAt);

      const rows = await db
        .select({
          id: orders.id,
          createdAt: orders.createdAt,
          status: orders.status,
          paymentStatus: orders.paymentStatus,
          paymentMethod: orders.paymentMethod,
          paymentProvider: orders.paymentProvider,
          providerStatus: orders.providerStatus,
          providerReference: orders.providerReference,
          bankTransferExpiresAt: orders.bankTransferExpiresAt,
          canMarkPaid: sql<boolean>`
            (
              (${orders.paymentMethod} = 'bank' OR ${orders.paymentProvider} = 'bank_transfer')
              AND COALESCE(${orders.status}, 'pending') != 'cancelled'
              AND NOT (
                COALESCE(${orders.paymentStatus}, 'unpaid') = 'paid'
                AND COALESCE(${orders.status}, 'pending') IN ('confirmed', 'fulfilled')
              )
            )
          `,
          canMarkExpired: sql<boolean>`
            (
              (${orders.paymentMethod} = 'bank' OR ${orders.paymentProvider} = 'bank_transfer')
              AND COALESCE(${orders.paymentStatus}, 'unpaid') != 'paid'
              AND COALESCE(${orders.status}, 'pending') != 'cancelled'
            )
          `,
          total: orders.total,
          stockDeductedAt: orders.stockDeductedAt,
          customerName: orders.customerName,
          customerEmail: orders.customerEmail,
        })
        .from(orders)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset);

      return res.json({
        ok: true,
        limit,
        offset,
        items: rows,
      });
    } catch (err: any) {
      return res.status(500).json({ error: "ops_orders_failed", message: err?.message || "unknown" });
    }
  });

  app.get("/api/ops/orders/:id", async (req, res) => {
    if (!requireOpsToken(req, res)) return;

    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "missing_order_id" });

      const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!order) return res.status(404).json({ error: "order_not_found" });

      return res.json({
        ok: true,
        order,
        ops: {
          canMarkPaid: canMarkPaid(order),
          canMarkExpired: canMarkExpired(order),
        },
        parsedItems: buildItemsPayload(order),
      });
    } catch (err: any) {
      return res.status(500).json({ error: "ops_order_failed", message: err?.message || "unknown" });
    }
  });

  app.post("/api/ops/orders/:id/mark-paid", async (req, res) => {
    if (!requireOpsToken(req, res)) return;

    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "missing_order_id" });

      const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!order) return res.status(404).json({ error: "order_not_found" });

      if (!isBankOrder(order)) {
        return res.status(400).json({ error: "invalid_payment_provider", message: "bank orders only" });
      }

      if (order.status === "cancelled") {
        return res.status(409).json({ error: "invalid_order_state", message: "cancelled order cannot be marked paid" });
      }

      const actor = getOpsActor(req);
      const completedBefore = await isOrderFinalizationCompleted(order.id);
      if (completedBefore) {
        await db.insert(auditLog).values({
          actorUserId: actor,
          action: "bank_transfer_manual_finalize_already_completed",
          entity: "order",
          entityId: order.id,
          severity: "info",
          meta: { source: "ops:manual-bank" },
        });
        return res.json({ ok: true, noOp: true, reason: "already_paid_finalized" });
      }

      const retryLikely =
        order.paymentStatus === "paid" ||
        ["confirmed", "fulfilled"].includes(String(order.status || "")) ||
        Boolean(order.paidAt) ||
        Boolean(order.paymentConfirmedAt);

      await db.insert(auditLog).values({
        actorUserId: actor,
        action: retryLikely ? "bank_transfer_manual_finalize_retried" : "bank_transfer_manual_finalize_attempt",
        entity: "order",
        entityId: order.id,
        severity: "info",
        meta: { source: "ops:manual-bank", retryLikely },
      });

      const parsed = parseOrderItemsForStock(order);
      if (!parsed.ok) {
        await db.insert(auditLog).values({
          actorUserId: actor,
          action: "bank_transfer_invalid_items_for_stock_deduction",
          entity: "order",
          entityId: order.id,
          severity: "important",
          meta: { source: "ops:manual-bank", reason: parsed.code },
        });
        console.error("bank_transfer_invalid_items_for_stock_deduction", {
          orderId: order.id,
          reason: parsed.code,
        });
        return res.status(409).json({ error: "invalid_items_for_stock_deduction", reason: parsed.code });
      }

      const stockResult = await deductStockOnceWithOrderLock(order.id, parsed.items as any);
      if (!stockResult.success) {
        await db.insert(auditLog).values({
          action: "stock_deduction_failed",
          entity: "order",
          entityId: order.id,
          severity: "important",
          meta: { source: "ops:manual-bank", failures: stockResult.failures },
        });
        return res.status(409).json({ error: "out_of_stock_or_reservation_failed", failures: stockResult.failures });
      }

      const finalize = await finalizePaidOrder({
        orderId: order.id,
        provider: "bank_transfer",
        providerEventId: `ops:mark-paid:${order.id}`,
        meta: { source: "ops:manual-bank", actor: actor || undefined },
      });

      if (!finalize.success) {
        return res.status(500).json({ error: "finalize_failed", message: finalize.error || "unknown" });
      }

      await db
        .update(orders)
        .set({
          paymentStatus: "paid",
          status: "confirmed",
          paidAt: new Date(),
          paymentConfirmedAt: new Date(),
          paymentConfirmedBy: actor,
          providerStatus: "manually_confirmed",
          paymentProvider: order.paymentProvider || "bank_transfer",
        })
        .where(eq(orders.id, order.id));

      const completedAfter = await isOrderFinalizationCompleted(order.id);
      if (!completedAfter) {
        return res.status(500).json({ error: "finalization_incomplete", message: "finalization not completed" });
      }

      await db.insert(auditLog).values({
        actorUserId: actor,
        action: "bank_transfer_manual_finalize_completed",
        entity: "order",
        entityId: order.id,
        severity: "info",
        meta: { finalizeSkipped: finalize.skipped },
      });

      await db.insert(auditLog).values({
        actorUserId: actor,
        action: "bank_transfer_manually_confirmed",
        entity: "order",
        entityId: order.id,
        severity: "info",
        meta: { finalizeSkipped: finalize.skipped },
      });

      const orderForEmail = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
      if (orderForEmail[0]) {
        const shouldSendFulfillment = await markEmailEventSent(order.id, "email_fulfillment_sent", `email_fulfillment:${order.id}`);
        if (shouldSendFulfillment) {
          sendFulfillmentNewOrderEmail(orderForEmail[0] as any).catch((err) =>
            console.error("[ops] Failed to send fulfillment email:", err)
          );
        }

        const shouldSendCustomer = await markEmailEventSent(order.id, "email_customer_sent", `email_customer:${order.id}`);
        if (shouldSendCustomer) {
          sendOrderConfirmationEmail(orderForEmail[0] as any).catch((err) =>
            console.error("[ops] Failed to send customer confirmation email:", err)
          );
        }
      }

      return res.json({ ok: true, orderId: order.id, finalizeSkipped: finalize.skipped });
    } catch (err: any) {
      return res.status(500).json({ error: "ops_mark_paid_failed", message: err?.message || "unknown" });
    }
  });

  app.post("/api/ops/orders/:id/mark-expired", async (req, res) => {
    if (!requireOpsToken(req, res)) return;

    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "missing_order_id" });

      const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!order) return res.status(404).json({ error: "order_not_found" });
      if (!isBankOrder(order)) {
        return res.status(400).json({ error: "invalid_payment_provider", message: "bank orders only" });
      }
      if (order.paymentStatus === "paid" || ["confirmed", "fulfilled"].includes(String(order.status || ""))) {
        return res.status(409).json({ error: "invalid_order_state", message: "paid/finalized order cannot be expired" });
      }
      if (order.status === "cancelled" || order.paymentStatus === "expired") {
        return res.json({ ok: true, noOp: true, reason: "already_expired_or_cancelled" });
      }

      const actor = getOpsActor(req);
      await db
        .update(orders)
        .set({
          paymentStatus: "expired",
          status: "cancelled",
          providerStatus: "manually_expired",
        })
        .where(eq(orders.id, order.id));

      await db.insert(auditLog).values({
        actorUserId: actor,
        action: "bank_transfer_manually_expired",
        entity: "order",
        entityId: order.id,
        severity: "info",
        meta: { source: "ops:manual-bank" },
      });

      return res.json({ ok: true, orderId: order.id, paymentStatus: "expired", status: "cancelled" });
    } catch (err: any) {
      return res.status(500).json({ error: "ops_mark_expired_failed", message: err?.message || "unknown" });
    }
  });
}

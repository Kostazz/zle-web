import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "./db";
import { orders } from "@shared/schema";

function requireOpsToken(req: Request, res: Response): boolean {
  const expected = process.env.OPS_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "ops_not_configured" });
    return false;
  }
  const provided = (req.headers["x-ops-token"] as string | undefined) || (req.query.token as string | undefined);
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
      const hasStockDeducted = parseBool(req.query.hasStockDeducted);
      const q = req.query.q ? String(req.query.q).trim() : "";

      const filters = [];

      if (status) filters.push(eq(orders.status, status));
      if (paymentStatus) filters.push(eq(orders.paymentStatus, paymentStatus));
      if (paymentMethod) filters.push(eq(orders.paymentMethod, paymentMethod));
      if (hasStockDeducted === true) filters.push(sql`${orders.stockDeductedAt} is not null`);
      if (hasStockDeducted === false) filters.push(sql`${orders.stockDeductedAt} is null`);

      if (q) {
        const like = `%${q}%`;
        filters.push(
          or(
            ilike(orders.id, like),
            ilike(orders.customerEmail, like),
            ilike(orders.customerName, like)
          )
        );
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
        parsedItems: buildItemsPayload(order),
      });
    } catch (err: any) {
      return res.status(500).json({ error: "ops_order_failed", message: err?.message || "unknown" });
    }
  });
}

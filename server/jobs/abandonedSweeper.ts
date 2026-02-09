import { and, eq, sql } from "drizzle-orm";

import { db } from "../db";
import { orders } from "@shared/schema";
import { env } from "../env";

const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

export function startAbandonedOrderSweeper() {
  if (!env.DATABASE_URL) return;

  setInterval(async () => {
    try {
      await db
        .update(orders)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(orders.status, "pending"),
            eq(orders.paymentStatus, "unpaid"),
            sql`${orders.paymentMethod} != 'cod'`,
            sql`${orders.stockDeductedAt} is null`,
            sql`${orders.createdAt} < now() - interval '24 hours'`
          )
        );
    } catch (err) {
      console.error("[sweeper] Failed to cancel abandoned orders:", err);
    }
  }, SWEEP_INTERVAL_MS);
}

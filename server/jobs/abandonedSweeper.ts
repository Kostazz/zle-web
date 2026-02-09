import { and, eq, sql } from "drizzle-orm";

import { db } from "../db";
import { orders } from "@shared/schema";
import { env } from "../env";

const DEFAULT_TTL_MINUTES = 1440;
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const MIN_TTL_MINUTES = 1;
const MAX_TTL_MINUTES = 7 * 24 * 60;
const MIN_INTERVAL_MS = 10 * 1000;
const MAX_INTERVAL_MS = 6 * 60 * 60 * 1000;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getSweeperConfig() {
  const ttlRaw = parseInt(env.ABANDONED_ORDER_TTL_MINUTES || "", 10);
  const intervalRaw = parseInt(env.ABANDONED_SWEEP_INTERVAL_MS || "", 10);

  const ttlMinutes = clampNumber(
    Number.isFinite(ttlRaw) ? ttlRaw : DEFAULT_TTL_MINUTES,
    MIN_TTL_MINUTES,
    MAX_TTL_MINUTES
  );

  const intervalMs = clampNumber(
    Number.isFinite(intervalRaw) ? intervalRaw : DEFAULT_INTERVAL_MS,
    MIN_INTERVAL_MS,
    MAX_INTERVAL_MS
  );

  const runOnBoot = env.ABANDONED_SWEEP_RUN_ON_BOOT !== "false";

  return { ttlMinutes, intervalMs, runOnBoot };
}

export async function runAbandonedOrderSweep(opts?: { dryRun?: boolean }) {
  const { ttlMinutes, intervalMs } = getSweeperConfig();
  const dryRun = Boolean(opts?.dryRun);

  const whereClause = and(
    eq(orders.status, "pending"),
    eq(orders.paymentStatus, "unpaid"),
    sql`${orders.paymentMethod} != 'cod'`,
    sql`${orders.stockDeductedAt} is null`,
    sql`${orders.createdAt} < now() - (${ttlMinutes} * interval '1 minute')`
  );

  const matchedRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(orders)
    .where(whereClause);
  const matched = matchedRows[0]?.count ?? 0;

  let cancelled = 0;
  if (!dryRun) {
    await db.update(orders).set({ status: "cancelled" }).where(whereClause);
    cancelled = matched;
  }

  console.log("[sweeper:abandoned] run", { ttlMinutes, intervalMs, matched, cancelled, dryRun });

  return { matched, cancelled, ttlMinutes, intervalMs, dryRun };
}

export function startAbandonedOrderSweeper() {
  if (!env.DATABASE_URL) return;

  const { intervalMs, runOnBoot } = getSweeperConfig();

  if (runOnBoot) {
    runAbandonedOrderSweep().catch((err) =>
      console.error("[sweeper] Failed to cancel abandoned orders:", err)
    );
  }

  setInterval(async () => {
    try {
      await runAbandonedOrderSweep();
    } catch (err) {
      console.error("[sweeper] Failed to cancel abandoned orders:", err);
    }
  }, intervalMs);
}

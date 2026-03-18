import { asc } from "drizzle-orm";

import { db } from "../db";
import { orders } from "../../shared/schema";
import { persistAgentReport } from "./core/signal";

type WatchdogIssueType =
  | "ghost_order"
  | "paid_mismatch"
  | "stuck_pending"
  | "coingate_divergence"
  | "zombie_checkout";

type WatchdogIssue = {
  type: WatchdogIssueType;
  orderId: string;
  ageMinutes: number;
  paymentStatus: string | null;
  status: string;
};

export type WatchdogReport = {
  agent: "payment_watchdog";
  timestamp: string;
  status: "ok" | "warning" | "critical";
  summary: string;
  issues: WatchdogIssue[];
  metrics: {
    totalOrdersScanned: number;
    issueCount: number;
    issueCountsByType: Record<WatchdogIssueType, number>;
  };
};

const COINGATE_METHODS = new Set(["btc", "eth", "usdc", "sol"]);
const ISSUE_TYPE_ORDER: WatchdogIssueType[] = [
  "ghost_order",
  "paid_mismatch",
  "stuck_pending",
  "coingate_divergence",
  "zombie_checkout",
];

function getAgeMinutes(createdAt: Date | null, now: Date): number {
  if (!createdAt) {
    return 0;
  }

  const diffMs = now.getTime() - createdAt.getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

function getReportStatus(issueCount: number): WatchdogReport["status"] {
  if (issueCount === 0) {
    return "ok";
  }

  if (issueCount <= 3) {
    return "warning";
  }

  return "critical";
}

function buildSummary(issueCount: number, totalOrdersScanned: number): string {
  if (issueCount === 0) {
    return `No payment anomalies detected across ${totalOrdersScanned} orders.`;
  }

  return `Detected ${issueCount} payment anomalies across ${totalOrdersScanned} orders.`;
}

export async function runPaymentWatchdog(): Promise<WatchdogReport> {
  const now = new Date();
  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      createdAt: orders.createdAt,
      paymentConfirmedAt: orders.paymentConfirmedAt,
      paymentMethod: orders.paymentMethod,
    })
    .from(orders)
    .orderBy(asc(orders.createdAt), asc(orders.id));

  const issues: WatchdogIssue[] = [];
  const issueCountsByType: Record<WatchdogIssueType, number> = {
    ghost_order: 0,
    paid_mismatch: 0,
    stuck_pending: 0,
    coingate_divergence: 0,
    zombie_checkout: 0,
  };

  for (const row of rows) {
    const orderStatus = row.status ?? "unknown";
    const paymentStatus = row.paymentStatus ?? null;
    const paymentMethod = String(row.paymentMethod ?? "").toLowerCase();
    const ageMinutes = getAgeMinutes(row.createdAt, now);

    const recordIssue = (type: WatchdogIssueType) => {
      issueCountsByType[type] += 1;
      issues.push({
        type,
        orderId: row.id,
        ageMinutes,
        paymentStatus,
        status: orderStatus,
      });
    };

    if (paymentStatus === "paid" && !["confirmed", "fulfilled"].includes(orderStatus)) {
      recordIssue("paid_mismatch");
      continue;
    }

    if (COINGATE_METHODS.has(paymentMethod) && paymentStatus !== "paid" && ageMinutes > 20) {
      recordIssue("coingate_divergence");
      continue;
    }

    if (orderStatus === "pending" && ageMinutes > 120) {
      recordIssue("stuck_pending");
      continue;
    }

    if (orderStatus === "pending" && paymentStatus !== "paid" && ageMinutes > 20) {
      recordIssue("ghost_order");
      continue;
    }

    if (orderStatus === "pending" && ageMinutes > 30) {
      recordIssue("zombie_checkout");
    }
  }

  issues.sort((left, right) => {
    const typeCompare = ISSUE_TYPE_ORDER.indexOf(left.type) - ISSUE_TYPE_ORDER.indexOf(right.type);
    if (typeCompare !== 0) {
      return typeCompare;
    }

    if (left.orderId !== right.orderId) {
      return left.orderId.localeCompare(right.orderId);
    }

    return left.ageMinutes - right.ageMinutes;
  });

  const report: WatchdogReport = {
    agent: "payment_watchdog",
    timestamp: now.toISOString(),
    status: getReportStatus(issues.length),
    summary: buildSummary(issues.length, rows.length),
    issues,
    metrics: {
      totalOrdersScanned: rows.length,
      issueCount: issues.length,
      issueCountsByType,
    },
  };

  try {
    await persistAgentReport(report);
  } catch (error) {
    console.error("[payment_watchdog] Failed to persist watchdog report:", error);
  }

  return report;
}

function isMainModule() {
  const entry = process.argv[1];
  return entry === "server/agents/paymentWatchdog.ts" || entry?.endsWith("/server/agents/paymentWatchdog.ts") || false;
}

if (isMainModule()) {
  runPaymentWatchdog()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error("[payment_watchdog] Failed to read orders:", error);
      process.exitCode = 1;
    });
}

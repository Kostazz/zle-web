import { desc } from "drizzle-orm";

import { agentReports, type AgentReport, type InsertAgentReport } from "../../../shared/schema";
import { db } from "../../db";
import type { WatchdogReport } from "../paymentWatchdog";

export type AgentSignalReport = WatchdogReport;

function shouldPersistReport(report: AgentSignalReport) {
  return report.status === "warning" || report.status === "critical";
}

export async function persistAgentReport(report: AgentSignalReport): Promise<AgentReport | null> {
  if (!shouldPersistReport(report)) {
    return null;
  }

  const values: InsertAgentReport = {
    agent: report.agent,
    status: report.status,
    summary: report.summary,
    issuesJson: JSON.stringify(report.issues),
    metricsJson: JSON.stringify(report.metrics),
  };

  const [created] = await db.insert(agentReports).values(values).returning();
  return created ?? null;
}

export async function listAgentReports(limit: number): Promise<AgentReport[]> {
  return db
    .select()
    .from(agentReports)
    .orderBy(desc(agentReports.createdAt), desc(agentReports.id))
    .limit(limit);
}

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { computeAuditChainHash, sha256File, type AuditChainRecord } from "./audit-chain.ts";
import { createSourceRunId, runTotalboardshopSourceAgent } from "./source-totalboardshop.ts";
import { decideRun, type DecisionOutput } from "./decision-agent.ts";

type PipelineMode = "staged-only" | "publish-approved";

export type PipelineArgs = {
  runId?: string;
  mode: PipelineMode;
};

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`));
    });
    child.on("error", reject);
  });
}

async function updateRunAudit(runId: string, extraArtifacts: Record<string, string>): Promise<string> {
  const runDir = path.join("tmp", "source-datasets", runId);
  const auditPath = path.join(runDir, "audit.json");
  const audit = JSON.parse(await fs.promises.readFile(auditPath, "utf8")) as AuditChainRecord;

  for (const [key, relOrAbsPath] of Object.entries(extraArtifacts)) {
    const absPath = path.isAbsolute(relOrAbsPath) ? relOrAbsPath : path.join(process.cwd(), relOrAbsPath);
    if (!fs.existsSync(absPath)) continue;
    audit.artifacts[key] = {
      path: path.relative(runDir, absPath).split(path.sep).join("/"),
      sha256: await sha256File(absPath),
    };
  }

  audit.chain.currentRunHash = computeAuditChainHash(runId, audit.artifacts, audit.chain.previousRunHash);
  await fs.promises.writeFile(auditPath, JSON.stringify(audit, null, 2), "utf8");
  return audit.chain.currentRunHash;
}

async function writePublishLog(runId: string, decision: DecisionOutput, auditHash: string): Promise<string> {
  const startedAt = new Date().toISOString();
  const publishRunId = `${runId}-publish`;

  const reportPath = path.join("tmp", "agent-reports", `${publishRunId}.json`);
  const manifestPath = path.join("tmp", "agent-manifests", `${publishRunId}.run.json`);
  await runCommand("npm", [
    "run",
    "photos:ingest",
    "--",
    "--input",
    path.join("tmp", "source-datasets", runId, "images"),
    "--direct",
    "--source-type",
    "manual",
    "--run-id",
    publishRunId,
  ]);

  const log = {
    sourceRunId: runId,
    publishRunId,
    startedAt,
    finishedAt: new Date().toISOString(),
    decision: decision.decision,
    published: true,
    reportPath,
    manifestPath,
    auditHash,
  };

  const outputPath = path.join("tmp", "publish-logs", `${runId}.json`);
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, JSON.stringify(log, null, 2), "utf8");
  return outputPath;
}

export async function runPipeline(args: PipelineArgs): Promise<{ runId: string; decision: DecisionOutput; published: boolean }> {
  const runId = args.runId ?? createSourceRunId();

  await runTotalboardshopSourceAgent({
    runId,
    outputRoot: path.join("tmp", "source-datasets"),
    seedUrl: "https://totalboardshop.cz/nabidka-znacek/?brands=zle-skateboarding",
    maxPages: 40,
    maxProducts: 30,
    maxImagesPerProduct: 8,
    maxImageBytes: 8_000_000,
  });

  await runCommand("npm", [
    "run",
    "photos:ingest",
    "--",
    "--input",
    path.join("tmp", "source-datasets", runId, "images"),
    "--staged",
    "--source-type",
    "manual",
    "--run-id",
    runId,
  ]);

  const decision = decideRun(runId);
  const decisionDir = path.join("tmp", "agent-decisions");
  await fs.promises.mkdir(decisionDir, { recursive: true });
  const decisionPath = path.join(decisionDir, `${runId}.decision.json`);
  await fs.promises.writeFile(decisionPath, JSON.stringify(decision, null, 2), "utf8");

  const reportPath = path.join("tmp", "agent-reports", `${runId}.json`);
  const manifestPath = path.join("tmp", "agent-manifests", `${runId}.run.json`);
  let auditHash = await updateRunAudit(runId, {
    ingestReport: reportPath,
    decisionManifest: decisionPath,
    ingestManifest: manifestPath,
  });

  let published = false;
  if (args.mode === "publish-approved" && decision.decision === "AUTO_APPROVE") {
    const publishLogPath = await writePublishLog(runId, decision, auditHash);
    auditHash = await updateRunAudit(runId, { publishLog: publishLogPath });
    published = true;
  }

  return { runId, decision, published };
}

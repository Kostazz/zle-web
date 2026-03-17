import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type AuditEntry = {
  path: string;
  sha256: string;
};

export type AuditChainRecord = {
  runId: string;
  createdAt: string;
  artifacts: Record<string, AuditEntry>;
  chain: {
    previousRunHash: string | null;
    currentRunHash: string;
  };
};

export async function sha256File(targetPath: string): Promise<string> {
  const bytes = await fs.promises.readFile(targetPath);
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function stableObjectStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableObjectStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableObjectStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeAuditChainHash(runId: string, artifacts: Record<string, AuditEntry>, previousRunHash: string | null): string {
  const payload = stableObjectStringify({ runId, artifacts, previousRunHash });
  return `sha256:${crypto.createHash("sha256").update(payload).digest("hex")}`;
}

export async function readLatestAuditHash(outputRoot: string): Promise<string | null> {
  if (!fs.existsSync(outputRoot)) return null;
  const runDirs = (await fs.promises.readdir(outputRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  for (const runId of runDirs) {
    const auditPath = path.join(outputRoot, runId, "audit.json");
    if (!fs.existsSync(auditPath)) continue;
    try {
      const parsed = JSON.parse(await fs.promises.readFile(auditPath, "utf8")) as AuditChainRecord;
      if (parsed?.chain?.currentRunHash) return parsed.chain.currentRunHash;
    } catch {
      continue;
    }
  }

  return null;
}

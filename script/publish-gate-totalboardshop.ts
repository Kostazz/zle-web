import fs from "node:fs";
import path from "node:path";
import { formatPublishGateStdout, runPublishGateAgent, validatePublishGateManifest, writePublishGateTemplate } from "./lib/publish-gate-agent.ts";

type CliArgs = {
  runId: string;
  input?: string;
  outputDir: string;
  writeTemplate: boolean;
  validateOnly: boolean;
};

type PublishGateFailureArtifact = {
  runId: string;
  mode: "write-template" | "validate-only" | "normalize";
  status: "failed";
  failureCode: string;
  failureReason: string;
  timestamp: string;
  upstreamRunIds: {
    sourceRunId?: string;
    reviewRunId?: string;
    stagingRunId?: string;
  };
  inputArtifacts: {
    inputPath?: string;
    outputDir: string;
    reviewPath?: string;
    stagingPath?: string;
    curationPath?: string;
  };
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    runId: "",
    outputDir: path.join("tmp", "publish-gates"),
    writeTemplate: false,
    validateOnly: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];
    switch (token) {
      case "--run-id":
        args.runId = next ?? "";
        index++;
        break;
      case "--input":
        args.input = next;
        index++;
        break;
      case "--output-dir":
        args.outputDir = next ?? args.outputDir;
        index++;
        break;
      case "--write-template":
        args.writeTemplate = true;
        break;
      case "--validate-only":
        args.validateOnly = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.runId) throw new Error("Missing --run-id");
  if (args.writeTemplate && args.validateOnly) throw new Error("--write-template and --validate-only are mutually exclusive");
  return args;
}

function normalizeOutputDir(outputDir: string): string {
  const allowedRoot = path.resolve("tmp", "publish-gates");
  const resolved = path.resolve(outputDir);
  const relative = path.relative(allowedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside tmp/publish-gates: ${outputDir}`);
  }
  return resolved;
}

function inferMode(args: CliArgs): PublishGateFailureArtifact["mode"] {
  if (args.writeTemplate) return "write-template";
  if (args.validateOnly) return "validate-only";
  return "normalize";
}

function classifyFailure(message: string): string {
  if (/Missing required artifact/i.test(message)) return "missing_required_artifact";
  if (/Invalid .* JSON/i.test(message)) return "invalid_json";
  if (/mismatch|collision|blocked/i.test(message)) return "gate_validation_failed";
  if (/outside tmp\/publish-gates/i.test(message)) return "output_path_rejected";
  if (/Unknown argument|Missing --run-id|mutually exclusive/i.test(message)) return "cli_usage_error";
  return "publish_gate_failed_closed";
}

async function writeFailureArtifacts(args: CliArgs, message: string): Promise<{ errorPath: string; summaryPath: string }> {
  const outputDir = normalizeOutputDir(args.outputDir);
  await fs.promises.mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString();
  const errorPath = path.join(outputDir, `${args.runId}.error.json`);
  const summaryPath = path.join(outputDir, `${args.runId}.summary.md`);
  const artifact: PublishGateFailureArtifact = {
    runId: args.runId,
    mode: inferMode(args),
    status: "failed",
    failureCode: classifyFailure(message),
    failureReason: message,
    timestamp,
    upstreamRunIds: {
      sourceRunId: args.runId,
      reviewRunId: args.runId,
      stagingRunId: args.runId,
    },
    inputArtifacts: {
      inputPath: args.input,
      outputDir: args.outputDir,
      reviewPath: path.join("tmp", "review-decisions", `${args.runId}.review.json`),
      stagingPath: path.join("tmp", "agent-manifests", `${args.runId}.staging.json`),
      curationPath: path.join("tmp", "curation", `${args.runId}.curation.json`),
    },
  };
  const lines = [
    "# TotalBoardShop Publish Gate Summary",
    "",
    `- Run ID: ${args.runId}`,
    `- Created At: ${timestamp}`,
    `- Mode: ${artifact.mode}`,
    `- Status: failed`,
    `- Failure Code: ${artifact.failureCode}`,
    "",
    "## Validation Errors",
    `- ${message}`,
    "",
    "## Guardrails",
    "- Validation failed closed.",
    "- This layer never executes publish.",
    "- This layer never writes live assets.",
    "- Writes are restricted to tmp/publish-gates.",
  ];
  await fs.promises.writeFile(errorPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(summaryPath, `${lines.join("\n")}\n`, "utf8");
  return { errorPath, summaryPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const input = {
    runId: args.runId,
    inputPath: args.input,
    outputDir: args.outputDir,
  };

  if (args.writeTemplate) {
    const result = await writePublishGateTemplate({ ...input, writeTemplate: true });
    for (const line of formatPublishGateStdout(result.manifest, "write-template")) console.log(line);
    if (result.manifestPath) console.log(`manifest ${result.manifestPath}`);
    if (result.summaryPath) console.log(`summary ${result.summaryPath}`);
    return;
  }

  if (args.validateOnly) {
    const result = await validatePublishGateManifest({ ...input, validateOnly: true });
    for (const line of formatPublishGateStdout(result.manifest, "validate-only")) console.log(line);
    return;
  }

  const result = await runPublishGateAgent(input);
  for (const line of formatPublishGateStdout(result.manifest, "normalize")) console.log(line);
  if (result.manifestPath) console.log(`manifest ${result.manifestPath}`);
  if (result.summaryPath) console.log(`summary ${result.summaryPath}`);
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  let args: CliArgs | null = null;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch {
    console.error(message);
    process.exit(1);
  }
  try {
    const failure = await writeFailureArtifacts(args, message);
    console.error(message);
    console.error(`error ${failure.errorPath}`);
    console.error(`summary ${failure.summaryPath}`);
  } catch (artifactError) {
    console.error(message);
    console.error(artifactError instanceof Error ? artifactError.message : String(artifactError));
  }
  process.exit(1);
});

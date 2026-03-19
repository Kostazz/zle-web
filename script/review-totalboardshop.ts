import fs from "node:fs";
import path from "node:path";
import {
  runReviewDecisionAgent,
  validateReviewDecisionManifest,
  writeReviewDecisionTemplate,
} from "./lib/review-decision-agent.ts";

type CliArgs = {
  runId: string;
  inputPath?: string;
  outputDir: string;
  writeTemplate: boolean;
  validateOnly: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    runId: "",
    outputDir: path.join("tmp", "review-decisions"),
    writeTemplate: false,
    validateOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];
    switch (token) {
      case "--run-id":
        args.runId = next ?? "";
        i++;
        break;
      case "--input":
        args.inputPath = next ?? "";
        i++;
        break;
      case "--output-dir":
        args.outputDir = next ?? args.outputDir;
        i++;
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
  if (args.writeTemplate && args.validateOnly) throw new Error("--write-template and --validate-only cannot be combined");
  return args;
}

function validateOutputDir(outputDir: string): string {
  const allowedRoot = path.resolve("tmp", "review-decisions");
  const resolved = path.resolve(outputDir);
  const relative = path.relative(allowedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside tmp/review-decisions: ${outputDir}`);
  }
  return resolved;
}

async function writeValidationFailureSummary(args: CliArgs, message: string): Promise<string> {
  const outputDir = validateOutputDir(args.outputDir);
  await fs.promises.mkdir(outputDir, { recursive: true });
  const summaryPath = path.join(outputDir, `${args.runId}.summary.md`);
  const lines = [
    "# TotalBoardShop Review Decision Summary",
    "",
    `- Run ID: ${args.runId}`,
    `- Created At: ${new Date().toISOString()}`,
    "",
    "## Validation Errors",
    `- ${message}`,
    "",
    "## Guardrails",
    "- Validation failed closed.",
    "- No staging action was executed.",
    "- No publish action was executed.",
    "- No writes were made outside tmp/review-decisions.",
  ];
  await fs.promises.writeFile(summaryPath, `${lines.join("\n")}\n`, "utf8");
  return summaryPath;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.writeTemplate) {
    const result = await writeReviewDecisionTemplate(args);
    console.log(`run ${result.report.runId}`);
    console.log(`mode template`);
    console.log(`reviewable_items ${result.manifest.decisions.length}`);
    console.log(`manifest ${result.manifestPath}`);
    console.log(`summary ${result.summaryPath}`);
    return;
  }

  if (args.validateOnly) {
    try {
      const result = await validateReviewDecisionManifest(args);
      console.log(`run ${result.report.runId}`);
      console.log(`mode validate-only`);
      console.log(`reviewed_items ${result.summary.totalReviewedItems}`);
      console.log(`approved ${result.summary.approvedCount}`);
      console.log(`rejected ${result.summary.rejectedCount}`);
      console.log(`hold ${result.summary.holdCount}`);
      console.log(`manifest ${args.inputPath ?? path.join(args.outputDir, `${args.runId}.review.json`)}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const summaryPath = await writeValidationFailureSummary(args, message);
      console.error(message);
      console.error(`summary ${summaryPath}`);
      process.exit(1);
    }
  }

  const result = await runReviewDecisionAgent(args);
  console.log(`run ${result.report.runId}`);
  console.log(`mode write-normalized`);
  console.log(`reviewed_items ${result.summary.totalReviewedItems}`);
  console.log(`approved ${result.summary.approvedCount}`);
  console.log(`rejected ${result.summary.rejectedCount}`);
  console.log(`hold ${result.summary.holdCount}`);
  console.log(`manifest ${result.manifestPath}`);
  console.log(`summary ${result.summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

import path from "node:path";
import { formatPublishGateStdout, runPublishGateAgent, validatePublishGateManifest, writePublishGateTemplate } from "./lib/publish-gate-agent.ts";

type CliArgs = {
  runId: string;
  input?: string;
  outputDir: string;
  writeTemplate: boolean;
  validateOnly: boolean;
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

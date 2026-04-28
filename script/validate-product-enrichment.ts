import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ZodError } from "zod";

import { parseProductEnrichmentManifest } from "./lib/product-enrichment.ts";

const defaultManifestPath = path.resolve("data/product-enrichment/zle-product-enrichment.json");

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue, index) => {
      const pointer = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${index + 1}. ${pointer}: ${issue.message}`;
    })
    .join("\n");
}

export async function validateProductEnrichmentManifest(manifestPath = defaultManifestPath): Promise<void> {
  const filePath = path.resolve(manifestPath);
  const raw = await fs.readFile(filePath, "utf8");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${(error as Error).message}`);
  }

  try {
    parseProductEnrichmentManifest(parsedJson);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Validation failed for ${filePath}:\n${formatZodError(error)}`);
    }
    throw error;
  }

  console.log(`Product enrichment manifest is valid: ${filePath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  validateProductEnrichmentManifest(process.argv[2]).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

import { z } from "zod";

const nonEmptyString = z.string().trim().min(1, "Must be a non-empty string");

const productEnrichmentKeySchema = z
  .string()
  .min(1, "Product ID must be a non-empty string")
  .refine((value) => value === value.trim(), "Product ID must not include leading or trailing whitespace");

export const productEnrichmentEntrySchema = z
  .object({
    displayName: nonEmptyString.optional(),
    description: nonEmptyString.optional(),
    material: nonEmptyString.optional(),
    dimensions: nonEmptyString.optional(),
    seoTitle: nonEmptyString.max(70, "seoTitle must be at most 70 characters").optional(),
    seoDescription: nonEmptyString.max(170, "seoDescription must be at most 170 characters").optional(),
    badges: z.array(nonEmptyString).optional(),
    tags: z.array(nonEmptyString).optional(),
    internalNotes: nonEmptyString.optional(),
  })
  .strict();

export const productEnrichmentManifestSchema = z.record(productEnrichmentKeySchema, productEnrichmentEntrySchema);

export type ProductEnrichmentEntry = z.infer<typeof productEnrichmentEntrySchema>;
export type ProductEnrichmentManifest = z.infer<typeof productEnrichmentManifestSchema>;

export function parseProductEnrichmentManifest(input: unknown): ProductEnrichmentManifest {
  return productEnrichmentManifestSchema.parse(input);
}

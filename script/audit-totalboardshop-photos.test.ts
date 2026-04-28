import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runPhotoAudit, isDirectCliEntrypoint } from "./audit-totalboardshop-photos.ts";

type ProductFixture = {
  key: string;
  slug: string;
  hashes: unknown[];
  imageUrls: unknown[];
  localPaths: unknown[];
  ingestedPaths?: unknown[];
};

function runId(label: string): string {
  return `${label}-${Date.now()}-${randomUUID()}`;
}

async function writeFixture(runIdValue: string, products: ProductFixture[]): Promise<void> {
  const runRoot = path.join("tmp", "source-datasets", runIdValue);
  await fs.promises.mkdir(runRoot, { recursive: true });
  const payload = products.map((product) => ({
    sourceProductKey: product.key,
    sourceSlug: product.slug,
    title: product.key,
    downloadedImages: product.localPaths,
    ingestedImagePaths: product.ingestedPaths,
    imageUrls: product.imageUrls,
    downloadedImageHashes: product.hashes,
  }));
  await fs.promises.writeFile(path.join(runRoot, "products.json"), JSON.stringify(payload, null, 2), "utf8");
  for (const product of products) {
    for (const filePath of product.localPaths) {
      if (typeof filePath !== "string" || filePath.trim().length < 1) continue;
      const absolute = path.join(runRoot, filePath);
      await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
      await fs.promises.writeFile(absolute, "fixture", "utf8");
    }
    for (const filePath of product.ingestedPaths ?? []) {
      if (typeof filePath !== "string" || filePath.trim().length < 1) continue;
      const absolute = path.join(runRoot, filePath);
      await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
      await fs.promises.writeFile(absolute, "fixture", "utf8");
    }
  }
}

async function cleanup(runIdValue: string): Promise<void> {
  await fs.promises.rm(path.join("tmp", "source-datasets", runIdValue), { recursive: true, force: true });
  await fs.promises.rm(path.join("tmp", "photo-audits", `${runIdValue}.photo-audit.json`), { force: true });
  await fs.promises.rm(path.join("tmp", "photo-audits", `${runIdValue}.summary.md`), { force: true });
}

test("duplicate hash risk includes structured evidence and non-null products/files", async () => {
  const id = runId("photo-audit-evidence");
  await writeFixture(id, [
    {
      key: "tricko-zle-skateboarding-orange-black",
      slug: "tricko-zle-skateboarding-orange-black",
      hashes: ["sha256:dup-hash-1"],
      imageUrls: ["https://totalboardshop.cz/wp-content/uploads/2025/04/53506.jpg"],
      localPaths: ["images/tricko-zle-skateboarding-orange-black/cover.jpg"],
    },
    {
      key: "tricko-zle-skateboarding-blue-white",
      slug: "tricko-zle-skateboarding-blue-white",
      hashes: ["sha256:dup-hash-1"],
      imageUrls: ["https://totalboardshop.cz/wp-content/uploads/2025/04/53506.jpg"],
      localPaths: ["images/tricko-zle-skateboarding-blue-white/cover.jpg"],
    },
  ]);

  try {
    const report = await runPhotoAudit({ runId: id, exitOnError: false });
    const duplicate = report.findings.find((finding) => finding.code === "duplicate_hash_cross_product_folder_risk");
    assert.ok(duplicate);
    assert.equal(duplicate.classification, "suspicious_cross_product_duplicate");
    assert.ok(Array.isArray(duplicate.products));
    assert.equal((duplicate.products ?? []).length, 2);
    assert.ok(Array.isArray(duplicate.files));
    assert.equal((duplicate.files ?? []).length, 2);
    assert.equal(typeof duplicate.evidence, "object");
    assert.equal((duplicate.evidence as { hash?: string }).hash, "sha256:dup-hash-1");
  } finally {
    await cleanup(id);
  }
});

test("family shared secondary duplicate is classified benign and confidence remains above zero", async () => {
  const id = runId("photo-audit-benign");
  await writeFixture(id, [
    {
      key: "tricko-zle-skateboarding-orange-black",
      slug: "tricko-zle-skateboarding-orange-black",
      hashes: ["sha256:primary-orange", "sha256:family-secondary"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53506.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53497-1-scaled.jpg",
      ],
      localPaths: [
        "images/tricko-zle-skateboarding-orange-black/cover.jpg",
        "images/tricko-zle-skateboarding-orange-black/02.jpg",
      ],
    },
    {
      key: "tricko-zle-skateboarding-blue-white",
      slug: "tricko-zle-skateboarding-blue-white",
      hashes: ["sha256:primary-blue", "sha256:family-secondary"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53507.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53497-1-scaled.jpg",
      ],
      localPaths: [
        "images/tricko-zle-skateboarding-blue-white/cover.jpg",
        "images/tricko-zle-skateboarding-blue-white/02.jpg",
      ],
    },
  ]);

  try {
    const report = await runPhotoAudit({ runId: id, exitOnError: false });
    const duplicate = report.findings.find((finding) => finding.duplicateHash === "sha256:family-secondary");
    assert.ok(duplicate);
    assert.equal(duplicate.classification, "benign_shared_family_image");
    assert.notEqual(report.confidence, 0);
  } finally {
    await cleanup(id);
  }
});

test("non-primary duplicate with same exact sourceUrl is benign even across different slug suffixes", async () => {
  const id = runId("photo-audit-benign-shared-sourceurl");
  await writeFixture(id, [
    {
      key: "mikina-zle-core-black-v1",
      slug: "mikina-zle-core-black-v1",
      hashes: ["sha256:unique-black", "sha256:shared-secondary-sourceurl"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/mikina-black-main.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53497-1-scaled.jpg",
      ],
      localPaths: [
        "images/mikina-zle-core-black-v1/01.jpg",
        "images/mikina-zle-core-black-v1/02.jpg",
      ],
    },
    {
      key: "tricko-zle-logo-white-edition",
      slug: "tricko-zle-logo-white-edition",
      hashes: ["sha256:unique-white", "sha256:shared-secondary-sourceurl"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/tricko-white-main.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53497-1-scaled.jpg",
      ],
      localPaths: [
        "images/tricko-zle-logo-white-edition/01.jpg",
        "images/tricko-zle-logo-white-edition/02.jpg",
      ],
    },
    {
      key: "ksiltovka-zle-red-drop",
      slug: "ksiltovka-zle-red-drop",
      hashes: ["sha256:unique-red", "sha256:shared-secondary-sourceurl"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/ksiltovka-red-main.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53497-1-scaled.jpg",
      ],
      localPaths: [
        "images/ksiltovka-zle-red-drop/01.jpg",
        "images/ksiltovka-zle-red-drop/02.jpg",
      ],
    },
  ]);

  try {
    const report = await runPhotoAudit({ runId: id, exitOnError: false });
    const duplicate = report.findings.find((finding) => finding.duplicateHash === "sha256:shared-secondary-sourceurl");
    assert.ok(duplicate);
    assert.equal(duplicate.classification, "benign_shared_family_image");
    assert.equal(duplicate.level, "warning");
  } finally {
    await cleanup(id);
  }
});

test("skateboarding variants shared 02.jpg non-primary duplicate with same sourceUrl is benign", async () => {
  const id = runId("photo-audit-skateboarding-shared-secondary-sourceurl");
  await writeFixture(id, [
    {
      key: "tricko-zle-skateboarding-orange-black",
      slug: "tricko-zle-skateboarding-orange-black",
      hashes: ["sha256:primary-orange", "sha256:c2d1e59-shared-secondary"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53506.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53497-1-scaled.jpg",
      ],
      localPaths: [
        "images/tricko-zle-skateboarding-orange-black/01.jpg",
        "images/tricko-zle-skateboarding-orange-black/02.jpg",
      ],
    },
    {
      key: "tricko-zle-skateboarding-blue-white",
      slug: "tricko-zle-skateboarding-blue-white",
      hashes: ["sha256:primary-blue", "sha256:c2d1e59-shared-secondary"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53507.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53497-1-scaled.jpg",
      ],
      localPaths: [
        "images/tricko-zle-skateboarding-blue-white/01.jpg",
        "images/tricko-zle-skateboarding-blue-white/02.jpg",
      ],
    },
    {
      key: "tricko-zle-skateboarding-green-grey",
      slug: "tricko-zle-skateboarding-green-grey",
      hashes: ["sha256:primary-green", "sha256:c2d1e59-shared-secondary"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53508.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53497-1-scaled.jpg",
      ],
      localPaths: [
        "images/tricko-zle-skateboarding-green-grey/01.jpg",
        "images/tricko-zle-skateboarding-green-grey/02.jpg",
      ],
    },
  ]);

  try {
    const report = await runPhotoAudit({ runId: id, exitOnError: false });
    const duplicate = report.findings.find((finding) => finding.duplicateHash === "sha256:c2d1e59-shared-secondary");
    assert.ok(duplicate);
    assert.equal(duplicate.classification, "benign_shared_family_image");
    assert.equal(duplicate.level, "warning");
    const evidence = duplicate.evidence as { files?: Array<{ slot?: string | null; isPrimary?: boolean; sourceUrl?: string | null }> };
    assert.equal((evidence.files ?? []).every((entry) => entry.slot === "02.jpg"), true);
    assert.equal((evidence.files ?? []).every((entry) => entry.isPrimary === false), true);
    assert.equal(
      (evidence.files ?? []).every((entry) => entry.sourceUrl === "https://totalboardshop.cz/wp-content/uploads/2025/04/53497-1-scaled.jpg"),
      true,
    );
  } finally {
    await cleanup(id);
  }
});

test("shared primary 01.jpg duplicate with same sourceUrl remains suspicious", async () => {
  const id = runId("photo-audit-primary");
  await writeFixture(id, [
    {
      key: "tricko-zle-skateboarding-orange-black",
      slug: "tricko-zle-skateboarding-orange-black",
      hashes: ["sha256:shared-primary"],
      imageUrls: ["https://totalboardshop.cz/wp-content/uploads/2025/04/53506.jpg"],
      localPaths: ["images/tricko-zle-skateboarding-orange-black/01.jpg"],
    },
    {
      key: "tricko-zle-skateboarding-blue-white",
      slug: "tricko-zle-skateboarding-blue-white",
      hashes: ["sha256:shared-primary"],
      imageUrls: ["https://totalboardshop.cz/wp-content/uploads/2025/04/53506.jpg"],
      localPaths: ["images/tricko-zle-skateboarding-blue-white/01.jpg"],
    },
  ]);

  try {
    const report = await runPhotoAudit({ runId: id, exitOnError: false });
    const duplicate = report.findings.find((finding) => finding.duplicateHash === "sha256:shared-primary");
    assert.ok(duplicate);
    assert.equal(duplicate.classification, "suspicious_cross_product_duplicate");
    assert.equal(duplicate.level, "risk");
  } finally {
    await cleanup(id);
  }
});

test("mixed primary-secondary duplicate remains suspicious", async () => {
  const id = runId("photo-audit-mixed-primary-secondary");
  await writeFixture(id, [
    {
      key: "tricko-zle-skateboarding-orange-black",
      slug: "tricko-zle-skateboarding-orange-black",
      hashes: ["sha256:mixed-duplicate", "sha256:unique-orange"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53506.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/unique-orange.jpg",
      ],
      localPaths: [
        "images/tricko-zle-skateboarding-orange-black/cover.jpg",
        "images/tricko-zle-skateboarding-orange-black/02.jpg",
      ],
    },
    {
      key: "tricko-zle-skateboarding-blue-white",
      slug: "tricko-zle-skateboarding-blue-white",
      hashes: ["sha256:unique-blue", "sha256:mixed-duplicate"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/unique-blue.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/53506.jpg",
      ],
      localPaths: [
        "images/tricko-zle-skateboarding-blue-white/cover.jpg",
        "images/tricko-zle-skateboarding-blue-white/02.jpg",
      ],
    },
  ]);

  try {
    const report = await runPhotoAudit({ runId: id, exitOnError: false });
    const duplicate = report.findings.find((finding) => finding.duplicateHash === "sha256:mixed-duplicate");
    assert.ok(duplicate);
    assert.equal(duplicate.classification, "suspicious_cross_product_duplicate");
    assert.equal(duplicate.level, "risk");
  } finally {
    await cleanup(id);
  }
});

test("duplicate hash preserves original index mapping when downloadedImageHashes contain invalid entries", async () => {
  const id = runId("photo-audit-hash-index-alignment");
  await writeFixture(id, [
    {
      key: "tricko-zle-skateboarding-orange-black",
      slug: "tricko-zle-skateboarding-orange-black",
      hashes: ["sha256:unique-orange", "", "sha256:index-sensitive-duplicate"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/unique-orange-cover.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/unused-invalid-hash.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/shared-third-image.jpg",
      ],
      localPaths: [
        "images/tricko-zle-skateboarding-orange-black/cover.jpg",
        "images/tricko-zle-skateboarding-orange-black/02.jpg",
        "images/tricko-zle-skateboarding-orange-black/03.jpg",
      ],
    },
    {
      key: "tricko-zle-skateboarding-blue-white",
      slug: "tricko-zle-skateboarding-blue-white",
      hashes: ["sha256:unique-blue", null, "sha256:index-sensitive-duplicate"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/unique-blue-cover.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/unused-invalid-hash-2.jpg",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/shared-third-image.jpg",
      ],
      localPaths: [
        "images/tricko-zle-skateboarding-blue-white/cover.jpg",
        "images/tricko-zle-skateboarding-blue-white/02.jpg",
        "images/tricko-zle-skateboarding-blue-white/03.jpg",
      ],
    },
  ]);

  try {
    const report = await runPhotoAudit({ runId: id, exitOnError: false });
    const duplicate = report.findings.find((finding) => finding.duplicateHash === "sha256:index-sensitive-duplicate");
    assert.ok(duplicate);
    const files = duplicate.files ?? [];
    assert.equal(files.some((filePath) => filePath.endsWith("/03.jpg")), true);
    assert.equal(files.some((filePath) => filePath.endsWith("/02.jpg")), false);
    const evidenceFiles = ((duplicate.evidence as { files?: Array<{ slot?: string | null }> }).files ?? []);
    assert.equal(evidenceFiles.every((entry) => entry.slot === "03.jpg"), true);
  } finally {
    await cleanup(id);
  }
});

test("runPhotoAudit rejects unsafe runId before any path usage", async () => {
  await assert.rejects(
    runPhotoAudit({ runId: "../evil", exitOnError: false }),
    /Invalid --run-id/,
  );
  assert.equal(fs.existsSync(path.join("tmp", "source-datasets", "evil")), false);
  assert.equal(fs.existsSync(path.join("tmp", "photo-audits", "../evil.photo-audit.json")), false);
});

test("shared 01.png duplicate remains suspicious primary reuse", async () => {
  const id = runId("photo-audit-primary-png");
  await writeFixture(id, [
    {
      key: "tricko-zle-skateboarding-orange-black",
      slug: "tricko-zle-skateboarding-orange-black",
      hashes: ["sha256:shared-primary-png"],
      imageUrls: ["https://totalboardshop.cz/wp-content/uploads/2025/04/53506.png"],
      localPaths: ["images/tricko-zle-skateboarding-orange-black/01.png"],
    },
    {
      key: "tricko-zle-skateboarding-blue-white",
      slug: "tricko-zle-skateboarding-blue-white",
      hashes: ["sha256:shared-primary-png"],
      imageUrls: ["https://totalboardshop.cz/wp-content/uploads/2025/04/53506.png"],
      localPaths: ["images/tricko-zle-skateboarding-blue-white/01.png"],
    },
  ]);

  try {
    const report = await runPhotoAudit({ runId: id, exitOnError: false });
    const duplicate = report.findings.find((finding) => finding.duplicateHash === "sha256:shared-primary-png");
    assert.ok(duplicate);
    assert.equal(duplicate.classification, "suspicious_cross_product_duplicate");
    assert.equal(duplicate.level, "risk");
  } finally {
    await cleanup(id);
  }
});

test("duplicate evidence keeps local-path index alignment when downloadedImages has gaps", async () => {
  const id = runId("photo-audit-local-path-gap-alignment");
  await writeFixture(id, [
    {
      key: "tricko-zle-skateboarding-orange-black",
      slug: "tricko-zle-skateboarding-orange-black",
      hashes: ["sha256:unique-orange", "sha256:unused", "sha256:gap-aligned-duplicate"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/unique-orange-cover.jpg",
        null,
        "https://totalboardshop.cz/wp-content/uploads/2025/04/shared-third-image.jpg",
      ],
      localPaths: [
        "",
        "images/tricko-zle-skateboarding-orange-black/02.jpg",
        "images/tricko-zle-skateboarding-orange-black/03.jpg",
      ],
    },
    {
      key: "tricko-zle-skateboarding-blue-white",
      slug: "tricko-zle-skateboarding-blue-white",
      hashes: ["sha256:unique-blue", "sha256:unused-blue", "sha256:gap-aligned-duplicate"],
      imageUrls: [
        "https://totalboardshop.cz/wp-content/uploads/2025/04/unique-blue-cover.jpg",
        "",
        "https://totalboardshop.cz/wp-content/uploads/2025/04/shared-third-image.jpg",
      ],
      localPaths: [
        null,
        "images/tricko-zle-skateboarding-blue-white/02.jpg",
        "images/tricko-zle-skateboarding-blue-white/03.jpg",
      ],
    },
  ]);

  try {
    const report = await runPhotoAudit({ runId: id, exitOnError: false });
    const duplicate = report.findings.find((finding) => finding.duplicateHash === "sha256:gap-aligned-duplicate");
    assert.ok(duplicate);
    const files = duplicate.files ?? [];
    assert.equal(files.some((filePath) => filePath.endsWith("/03.jpg")), true);
    assert.equal(files.some((filePath) => filePath.endsWith("/02.jpg")), false);
    const evidence = duplicate.evidence as { folders?: string[]; files?: Array<{ slot?: string | null; filePath?: string | null }> };
    assert.equal((evidence.folders ?? []).length, 2);
    assert.equal((evidence.files ?? []).every((entry) => entry.slot === "03.jpg"), true);
    assert.equal((evidence.files ?? []).every((entry) => (entry.filePath ?? "").endsWith("/03.jpg")), true);
    assert.equal(
      (evidence.files ?? []).every((entry) => entry.sourceUrl === "https://totalboardshop.cz/wp-content/uploads/2025/04/shared-third-image.jpg"),
      true,
    );
  } finally {
    await cleanup(id);
  }
});

test("duplicate hash across products stays visible when aligned local path evidence is missing", async () => {
  const id = runId("photo-audit-missing-aligned-local-path");
  await writeFixture(id, [
    {
      key: "tricko-zle-skateboarding-orange-black",
      slug: "tricko-zle-skateboarding-orange-black",
      hashes: ["sha256:shared-missing-path-evidence"],
      imageUrls: ["https://totalboardshop.cz/wp-content/uploads/2025/04/shared-a.jpg"],
      localPaths: [null],
    },
    {
      key: "tricko-zle-skateboarding-blue-white",
      slug: "tricko-zle-skateboarding-blue-white",
      hashes: ["sha256:shared-missing-path-evidence"],
      imageUrls: ["https://totalboardshop.cz/wp-content/uploads/2025/04/shared-a.jpg"],
      localPaths: [""],
    },
  ]);

  try {
    const report = await runPhotoAudit({ runId: id, exitOnError: false });
    const duplicate = report.findings.find((finding) => finding.duplicateHash === "sha256:shared-missing-path-evidence");
    assert.ok(duplicate);
    assert.equal(duplicate.code, "duplicate_hash_cross_product_folder_risk");
    assert.equal(duplicate.classification, "suspicious_cross_product_duplicate");
    assert.equal(duplicate.level, "risk");
    const evidence = duplicate.evidence as { missingAlignedLocalPathEvidenceCount?: number; files?: Array<{ filePath?: string | null; hasAlignedLocalPath?: boolean }> };
    assert.equal(evidence.missingAlignedLocalPathEvidenceCount, 2);
    assert.equal((evidence.files ?? []).every((entry) => entry.filePath === null), true);
    assert.equal((evidence.files ?? []).every((entry) => entry.hasAlignedLocalPath === false), true);
  } finally {
    await cleanup(id);
  }
});

test("downloadedImages stays authoritative and does not fallback per-index to ingestedImagePaths", async () => {
  const id = runId("photo-audit-authoritative-downloaded");
  await writeFixture(id, [
    {
      key: "tricko-zle-skateboarding-orange-black",
      slug: "tricko-zle-skateboarding-orange-black",
      hashes: ["sha256:unique-orange", "sha256:authoritative-no-fallback"],
      imageUrls: ["https://totalboardshop.cz/wp-content/uploads/2025/04/a.jpg", "https://totalboardshop.cz/wp-content/uploads/2025/04/shared.jpg"],
      localPaths: ["images/tricko-zle-skateboarding-orange-black/cover.jpg", ""],
      ingestedPaths: ["images/tricko-zle-skateboarding-orange-black/cover.jpg", "images/tricko-zle-skateboarding-orange-black/02.jpg"],
    },
    {
      key: "tricko-zle-skateboarding-blue-white",
      slug: "tricko-zle-skateboarding-blue-white",
      hashes: ["sha256:unique-blue", "sha256:authoritative-no-fallback"],
      imageUrls: ["https://totalboardshop.cz/wp-content/uploads/2025/04/b.jpg", "https://totalboardshop.cz/wp-content/uploads/2025/04/shared.jpg"],
      localPaths: ["images/tricko-zle-skateboarding-blue-white/cover.jpg", null],
      ingestedPaths: ["images/tricko-zle-skateboarding-blue-white/cover.jpg", "images/tricko-zle-skateboarding-blue-white/02.jpg"],
    },
  ]);

  try {
    const report = await runPhotoAudit({ runId: id, exitOnError: false });
    const duplicate = report.findings.find((finding) => finding.duplicateHash === "sha256:authoritative-no-fallback");
    assert.ok(duplicate);
    const evidence = duplicate.evidence as { missingAlignedLocalPathEvidenceCount?: number; files?: Array<{ filePath?: string | null }> };
    assert.equal(evidence.missingAlignedLocalPathEvidenceCount, 2);
    assert.equal((evidence.files ?? []).every((entry) => entry.filePath === null), true);
  } finally {
    await cleanup(id);
  }
});

test("ingestedImagePaths is used when downloadedImages has no valid paths at all", async () => {
  const id = runId("photo-audit-authoritative-ingested-fallback");
  await writeFixture(id, [
    {
      key: "tricko-zle-skateboarding-orange-black",
      slug: "tricko-zle-skateboarding-orange-black",
      hashes: ["sha256:ingested-fallback-dup"],
      imageUrls: ["https://totalboardshop.cz/wp-content/uploads/2025/04/shared-fallback.jpg"],
      localPaths: [""],
      ingestedPaths: ["images/tricko-zle-skateboarding-orange-black/03.jpg"],
    },
    {
      key: "tricko-zle-skateboarding-blue-white",
      slug: "tricko-zle-skateboarding-blue-white",
      hashes: ["sha256:ingested-fallback-dup"],
      imageUrls: ["https://totalboardshop.cz/wp-content/uploads/2025/04/shared-fallback.jpg"],
      localPaths: [null],
      ingestedPaths: ["images/tricko-zle-skateboarding-blue-white/03.jpg"],
    },
  ]);

  try {
    const report = await runPhotoAudit({ runId: id, exitOnError: false });
    const duplicate = report.findings.find((finding) => finding.duplicateHash === "sha256:ingested-fallback-dup");
    assert.ok(duplicate);
    assert.equal((duplicate.files ?? []).every((filePath) => filePath.endsWith("/03.jpg")), true);
  } finally {
    await cleanup(id);
  }
});

test("isDirectCliEntrypoint handles missing argv and symlinked script path safely", async () => {
  const moduleUrl = new URL("./audit-totalboardshop-photos.ts", import.meta.url).href;
  assert.equal(isDirectCliEntrypoint(moduleUrl, undefined), false);
  assert.equal(isDirectCliEntrypoint(moduleUrl, "/definitely/not/a/real/path.ts"), false);

  const linkDir = path.join("tmp", "photo-audit-entrypoint-link-test");
  const linkPath = path.join(linkDir, "audit-link.ts");
  await fs.promises.mkdir(linkDir, { recursive: true });

  try {
    const targetPath = path.resolve("script", "audit-totalboardshop-photos.ts");
    try {
      await fs.promises.symlink(targetPath, linkPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    assert.equal(isDirectCliEntrypoint(moduleUrl, linkPath), true);
  } finally {
    await fs.promises.rm(linkDir, { recursive: true, force: true });
  }
});

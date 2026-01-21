import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const IMAGES_DIR = path.join(ROOT, "client", "public", "images");

// co konvertujeme
const INPUT_EXTS = new Set([".jpg", ".jpeg", ".png"]);

// některé soubory nechceme (volitelné)
const SKIP_DIR_NAMES = new Set([".git", ".github", "node_modules"]);

// kvality (tweak podle chuti)
const WEBP_QUALITY = 82; // 75–85 je sweet spot
const AVIF_QUALITY = 45; // 35–55 je běžně OK

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function isInput(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return INPUT_EXTS.has(ext);
}

function stripExt(filePath: string): string {
  const ext = path.extname(filePath);
  return filePath.slice(0, -ext.length);
}

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
}

async function convertOne(filePath: string) {
  const base = stripExt(filePath);
  const webpPath = `${base}.webp`;
  const avifPath = `${base}.avif`;

  const relIn = path.relative(ROOT, filePath);
  const relWebp = path.relative(ROOT, webpPath);
  const relAvif = path.relative(ROOT, avifPath);

  // sharp pipeline z jednoho vstupu (clone pro různé výstupy)
  const input = sharp(filePath, { failOn: "none" });

  let created = 0;

  if (!fs.existsSync(webpPath)) {
    await ensureDir(webpPath);
    await input.clone().webp({ quality: WEBP_QUALITY }).toFile(webpPath);
    created++;
    console.log(`WEBP  + ${relWebp}  (from ${relIn})`);
  }

  if (!fs.existsSync(avifPath)) {
    await ensureDir(avifPath);
    await input.clone().avif({ quality: AVIF_QUALITY }).toFile(avifPath);
    created++;
    console.log(`AVIF  + ${relAvif}  (from ${relIn})`);
  }

  return created;
}

async function main() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error(`Missing directory: ${IMAGES_DIR}`);
    process.exit(1);
  }

  const all = walk(IMAGES_DIR);
  const inputs = all.filter(isInput);

  if (inputs.length === 0) {
    console.log("No input images found (.jpg/.jpeg/.png). Nothing to do.");
    return;
  }

  console.log(`Found ${inputs.length} input images in ${path.relative(ROOT, IMAGES_DIR)}`);

  let totalCreated = 0;

  // sekvenčně = stabilní, nezabije RAM/CPU (u velkého množství fotek je to bezpečnější)
  for (const file of inputs) {
    totalCreated += await convertOne(file);
  }

  console.log(`Done. Created ${totalCreated} files.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

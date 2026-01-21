// client/src/lib/image.ts

export type ResolvedImageSources = {
  original: string;
  webp?: string;
  avif?: string;
};

const EXT_RE = /\.(avif|webp|png|jpe?g)$/i;

export function resolveImageSources(src?: string): ResolvedImageSources {
  const original = (src ?? "").trim();
  if (!original) return { original: "" };

  const match = original.match(EXT_RE);
  if (!match) return { original };

  const ext = match[1].toLowerCase();
  const base = original.slice(0, -match[0].length);

  const webp = `${base}.webp`;
  const avif = `${base}.avif`;

  if (ext === "avif") return { original, webp, avif: original };
  if (ext === "webp") return { original, webp: original, avif };

  return { original, webp, avif };
}

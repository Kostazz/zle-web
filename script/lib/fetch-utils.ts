import { setTimeout as delay } from "node:timers/promises";

const ALLOWLISTED_HOSTS = new Set(["totalboardshop.cz", "www.totalboardshop.cz"]);

export type FetchLimits = {
  timeoutMs: number;
  maxHtmlBytes: number;
  maxImageBytes: number;
  minDelayMs: number;
  maxDelayMs: number;
};

export type SafeFetchResult = {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
};

function randomIntBetween(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function normalizeAllowedUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Malformed URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`Non-HTTPS URL blocked: ${rawUrl}`);
  }

  if (!ALLOWLISTED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`Non-allowlisted host blocked: ${parsed.hostname}`);
  }

  return parsed;
}

export async function jitterDelay(limits: FetchLimits): Promise<void> {
  const ms = randomIntBetween(limits.minDelayMs, limits.maxDelayMs);
  await delay(ms);
}

export async function safeFetchBinary(rawUrl: string, limits: FetchLimits, expectedType: "html" | "image"): Promise<SafeFetchResult> {
  const url = normalizeAllowedUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        "user-agent": "zle-source-agent/1.0 (+safe-crawl)",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect without location from ${url.toString()}`);
      const redirected = new URL(location, url);
      normalizeAllowedUrl(redirected.toString());
      throw new Error(`Redirect blocked (fail-closed): ${url.toString()} -> ${redirected.toString()}`);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url.toString()}`);
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const isHtml = contentType.includes("text/html");
    const isImage = contentType.startsWith("image/");

    if (expectedType === "html" && !isHtml) {
      throw new Error(`Unsupported content-type for HTML fetch: ${contentType}`);
    }

    if (expectedType === "image" && !isImage) {
      throw new Error(`Unsupported content-type for image fetch: ${contentType}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const maxBytes = expectedType === "html" ? limits.maxHtmlBytes : limits.maxImageBytes;
    if (bytes.byteLength > maxBytes) {
      throw new Error(`Payload too large (${bytes.byteLength} bytes > ${maxBytes}) at ${url.toString()}`);
    }

    return {
      url: url.toString(),
      status: response.status,
      contentType,
      body: bytes,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function extFromContentType(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("image/jpeg") || ct.includes("image/jpg")) return ".jpg";
  if (ct.includes("image/png")) return ".png";
  if (ct.includes("image/webp")) return ".webp";
  return ".img";
}

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { normalizeAllowedUrl } from "./fetch-utils.ts";

export type TotalboardshopHtmlAcquisitionResult = {
  finalUrl: string;
  status: number;
  contentType: string;
  html: string;
};

type PlaywrightModule = {
  chromium: {
    launch: (options: { headless: boolean }) => Promise<Browser>;
  };
};

export type TotalboardshopHtmlAcquirer = {
  fetchHtml(rawUrl: string): Promise<TotalboardshopHtmlAcquisitionResult>;
  close(): Promise<void>;
};

export type TotalboardshopHtmlAcquirerOptions = {
  timeoutMs: number;
  maxHtmlBytes: number;
  maxRetries?: number;
  playwrightModule?: PlaywrightModule;
};

type RequestLike = {
  url(): string;
  redirectedFrom(): RequestLike | null;
};

const RETRIABLE_ERROR_PATTERNS = [/timeout/i, /net::err/i, /network/i, /page crashed/i];

function isRetriableAcquisitionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return RETRIABLE_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
}

function normalizeHtmlContentType(contentType: string | undefined): string {
  return (contentType || "").trim();
}

function assertHtmlContentType(contentType: string, url: string): void {
  if (!contentType.toLowerCase().includes("text/html")) {
    throw new Error(`Unsupported content-type for HTML fetch: ${contentType || "<empty>"} at ${url}`);
  }
}

function parseContentLength(contentLength: string | undefined): number | null {
  if (!contentLength) return null;
  const parsed = Number.parseInt(contentLength, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

async function fetchSingleAttempt(page: Page, rawUrl: string, timeoutMs: number, maxHtmlBytes: number): Promise<TotalboardshopHtmlAcquisitionResult> {
  const allowlistedInput = normalizeAllowedUrl(rawUrl).toString();
  let chainError: Error | null = null;

  const requestListener = (request: { url(): string }) => {
    try {
      normalizeAllowedUrl(request.url());
    } catch {
      chainError = new Error("Non-allowlisted host blocked BEFORE navigation");
    }
  };
  const responseListener = (response: { url(): string }) => {
    try {
      normalizeAllowedUrl(response.url());
    } catch {
      chainError = new Error("Non-allowlisted response");
    }
  };

  await page.route(/(\/obchod\/|\/nabidka-znacek\/|\.html(?:\?|$))/i, (route) => {
    try {
      if (route.request().resourceType() === "document") {
        normalizeAllowedUrl(route.request().url());
      }
      return route.continue();
    } catch {
      chainError = new Error("Non-allowlisted host blocked BEFORE navigation");
      return route.abort("blockedbyclient");
    }
  });
  page.on("request", requestListener);
  page.on("response", responseListener);

  let response;
  try {
    response = await page.goto(allowlistedInput, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
  } finally {
    page.off("request", requestListener);
    page.off("response", responseListener);
    await page.unroute(/(\/obchod\/|\/nabidka-znacek\/|\.html(?:\?|$))/i);
  }

  if (chainError) throw chainError;

  if (!response) throw new Error(`Missing navigation response for ${allowlistedInput}`);
  if (!response.ok()) throw new Error(`HTTP ${response.status()} for ${allowlistedInput}`);
  let redirectCursor: RequestLike | null = response.request() as RequestLike;
  while (redirectCursor) {
    normalizeAllowedUrl(redirectCursor.url());
    redirectCursor = redirectCursor.redirectedFrom();
    if (redirectCursor) throw new Error("Redirect chain detected (fail-closed)");
  }

  const finalUrl = normalizeAllowedUrl(page.url()).toString();
  const responseUrl = normalizeAllowedUrl(response.url()).toString();
  if (new URL(responseUrl).host !== new URL(finalUrl).host) {
    throw new Error(`Cross-host redirect blocked (fail-closed): ${responseUrl} -> ${finalUrl}`);
  }

  const contentType = normalizeHtmlContentType(response.headers()["content-type"]);
  assertHtmlContentType(contentType, finalUrl);

  const preflightLength = parseContentLength(response.headers()["content-length"]);
  if (preflightLength !== null && preflightLength > maxHtmlBytes) {
    throw new Error(`Payload too large by content-length (${preflightLength} bytes > ${maxHtmlBytes}) at ${finalUrl}`);
  }

  const html = await page.content();
  const htmlBytes = Buffer.byteLength(html, "utf8");
  if (htmlBytes > maxHtmlBytes) throw new Error(`Payload too large (${htmlBytes} bytes > ${maxHtmlBytes}) at ${finalUrl}`);
  if (!html.trim()) throw new Error(`Empty HTML body for ${finalUrl}`);

  return {
    finalUrl,
    status: response.status(),
    contentType,
    html,
  };
}

export async function createTotalboardshopHtmlAcquirer(options: TotalboardshopHtmlAcquirerOptions): Promise<TotalboardshopHtmlAcquirer> {
  const maxRetries = options.maxRetries ?? 2;
  const playwrightModule = options.playwrightModule ?? ({ chromium } as PlaywrightModule);
  const browser = await playwrightModule.chromium.launch({ headless: true });
  let context: BrowserContext;
  try {
    context = await browser.newContext();
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }

  async function close(): Promise<void> {
    await context.close();
    await browser.close();
  }

  return {
    async fetchHtml(rawUrl: string): Promise<TotalboardshopHtmlAcquisitionResult> {
      let attempt = 0;
      let lastError: unknown;

      while (attempt <= maxRetries) {
        const page = await context.newPage();
        try {
          return await fetchSingleAttempt(page, rawUrl, options.timeoutMs, options.maxHtmlBytes);
        } catch (error) {
          lastError = error;
          if (!isRetriableAcquisitionError(error) || attempt >= maxRetries) {
            throw error;
          }
          attempt += 1;
        } finally {
          await page.close().catch(() => undefined);
        }
      }

      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
    close,
  };
}

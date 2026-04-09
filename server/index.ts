import "dotenv/config";
import fs from "node:fs";
import path from "path";
import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";

import { securityHeaders } from "./security/headers";

import { registerRoutes } from "./routes";
import { isStripeAvailable, disableStripe } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import { seedPartners } from "./payouts";
import { requestIdMiddleware } from "./middleware/requestId";
import { apiLimiter, strictLimiter } from "./middleware/rateLimit";
import { env, flags, printEnvStatus, getHealthData } from "./env";
import { startAbandonedOrderSweeper } from "./jobs/abandonedSweeper";
import { injectSeo, injectSeoWithOptions } from "./seo/injectSeo";
import { storage } from "./storage";
import { validateRequiredEnv } from "./utils/validateEnv";
import {
  buildProductJsonLd,
  buildProductMetaDescription,
  buildProductMetaTitle,
  toAbsoluteUrl,
} from "@shared/productSeo";
import { resolveProductAssetAbsolutePath, shouldBypassGenericImagesStatic } from "./utils/productAssetsResolver";

validateRequiredEnv();

const app = express();
app.disable("x-powered-by");

// Project root (Render + local safe)
const PROJECT_ROOT = process.cwd();

// ----- helpers -----
function isProd() {
  return env.NODE_ENV === "production";
}

function shouldLog(source: string) {
  if (!isProd()) return true;
  return source === "system" || source === "startup";
}

export function log(message: string, source = "express") {
  if (!shouldLog(source)) return;
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}


function safeJsonLd(payload: unknown): string {
  return JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function injectJsonLdScript(html: string, id: string, payload: unknown): string {
  const scriptTag = `<script type="application/ld+json" id="${id}">${safeJsonLd(payload)}</script>`;
  if (html.includes("</head>")) {
    return html.replace("</head>", `  ${scriptTag}
</head>`);
  }
  return `${html}
${scriptTag}`;
}

// ----- static images -----
const liveImagesRoot = path.join(PROJECT_ROOT, "client", "public", "images");
const liveProductsRoot = path.join(PROJECT_ROOT, "client", "public", "images", "products");
const altLiveProductsRoot = path.join(PROJECT_ROOT, "public", "images", "products");
const productAssetsResolverMode = process.env.PRODUCT_ASSETS_RESOLVER_MODE === "v3-versioned-assets"
  ? "v3-versioned-assets"
  : "v2-root-switch";

// Compatibility mounts for product-image roots:
// - primary assets in client/public/images/products/<product-id>/...
// - alternate deploys that materialize public/images/products at repo root
// NOTE: altLiveProductsRoot is intentionally kept until deploy strategy is fully unified.
if (productAssetsResolverMode === "v3-versioned-assets") {
  app.get("/images/products/:productId/:fileName", apiLimiter, async (req, res) => {
    try {
      const resolved = await resolveProductAssetAbsolutePath(
        String(req.params.productId ?? ""),
        String(req.params.fileName ?? ""),
        "v3-versioned-assets",
      );
      if (!resolved) {
        return res.status(404).type("text/plain; charset=utf-8").send("Not Found");
      }
      return res.sendFile(resolved);
    } catch {
      return res.status(404).type("text/plain; charset=utf-8").send("Not Found");
    }
  });
  app.use("/images", (req, res, next) => {
    if (shouldBypassGenericImagesStatic(req.path, "v3-versioned-assets")) return next();
    return express.static(liveImagesRoot)(req, res, next);
  });
} else {
  app.use("/images", express.static(liveImagesRoot));
  app.use("/images/products", express.static(liveProductsRoot));
  app.use("/images/products", express.static(altLiveProductsRoot));
}

// IMPORTANT:
// Missing image/static asset requests must NOT fall through to SPA index.html.
// If no image file was found in any mounted image roots, return a real 404 here.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (/^\/images(?:\/|$)/.test(req.path)) {
    return res.status(404).type("text/plain; charset=utf-8").send("Not Found");
  }
  return next();
});

// ----- server -----
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// ----- middleware -----
app.use(requestIdMiddleware);

app.set("trust proxy", 1);

// ----- canonical domain + HTTPS (SEO hardening) -----
// Enforces: https + non-www (based on PUBLIC_BASE_URL)
if (isProd()) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Skip health/API: keep it simple and avoid surprises for webhooks/calls
    if (req.path.startsWith("/api") || req.path === "/health") return next();

    const base = process.env.PUBLIC_BASE_URL;
    if (!base) return next();

    let canonicalHost = "";
    let canonicalProto = "https";
    try {
      const u = new URL(base);
      canonicalHost = u.host;
      canonicalProto = u.protocol.replace(":", "") || "https";
    } catch {
      return next();
    }

    const xfProto = (req.headers["x-forwarded-proto"] as string | undefined) || req.protocol;
    const xfHost = (req.headers["x-forwarded-host"] as string | undefined) || req.get("host") || "";
    const reqProto = (xfProto || "https").split(",")[0].trim();
    const reqHost = (xfHost || "").split(",")[0].trim();

    // Normalize target URL (keep path + query)
    const targetProto = canonicalProto || "https";
    const targetHost = canonicalHost;

    const needsProto = reqProto && targetProto && reqProto !== targetProto;
    const needsHost = reqHost && targetHost && reqHost !== targetHost;

    if (needsProto || needsHost) {
      const target = `${targetProto}://${targetHost}${req.originalUrl}`;
      return res.redirect(301, target);
    }

    // Extra safety: if canonicalHost is non-www, kill accidental www even without PUBLIC_BASE_URL mismatch
    if (!targetHost.startsWith("www.") && reqHost.startsWith("www.")) {
      const target = `${targetProto}://${targetHost}${req.originalUrl}`;
      return res.redirect(301, target);
    }

    return next();
  });
}

app.use(securityHeaders());

// ----- health -----
app.get("/health", (_req, res) => res.json(getHealthData()));
app.get("/api/health", (_req, res) => res.json(getHealthData()));

// ----- Stripe webhook (raw) -----
app.post(
  "/api/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!flags.ENABLE_STRIPE) {
      return res.status(503).json({ error: "Stripe disabled" });
    }

    const signature = req.headers["stripe-signature"];
    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature" });
    }


    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;

      if (!Buffer.isBuffer(req.body)) {
        return res.status(500).json({ error: "Webhook processing error" });
      }

      await WebhookHandlers.processWebhook(req.body, sig);
      return res.status(200).json({ received: true });
    } catch (e: any) {
      // Stripe will retry on non-2xx.
      // Keep response 400 for signature/uuid/body issues, but ALWAYS log enough to debug in prod.
      // Do NOT log secrets or full payload.
      const errType = e?.type || e?.name || "unknown";
      const errMsg = e?.message || String(e);
      const requestId = (req as any).id || (req.headers["x-request-id"] as string | undefined);

      console.error("[stripe:webhook]", {
        requestId,
        type: errType,
        message: errMsg,
        hasWebhookSecret: Boolean(env.STRIPE_WEBHOOK_SECRET),
        hasSignature: Boolean(signature),
        isBuffer: Buffer.isBuffer(req.body),
      });

      // Common root causes:
      // - STRIPE_WEBHOOK_SECRET mismatch (most common)
      // - Body parsed before raw handler (would show isBuffer=false)
      return res.status(400).json({ error: "Webhook processing error" });
    }
  }
);

// ----- rate limits -----
app.use("/api", apiLimiter);
app.use("/api/checkout", strictLimiter);

// ----- body parsers -----
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// ----- API logging -----
app.use((req, res, next) => {
  const start = Date.now();
  const p = req.path;

  res.on("finish", () => {
    if (!p.startsWith("/api")) return;

    const duration = Date.now() - start;
    const status = res.statusCode;

    if (isProd()) {
      if (p === "/api/auth/user" && status === 401) return;
      if (status >= 500 || status === 429) {
        console.warn(`${req.method} ${p} ${status} in ${duration}ms`);
      }
      return;
    }

    log(`${req.method} ${p} ${status} in ${duration}ms`);
  });

  next();
});

// ----- Stripe init -----
async function initStripe() {
  if (!flags.ENABLE_STRIPE || !isStripeAvailable()) {
    disableStripe();
    return;
  }
  log("Stripe enabled", "stripe");
}

// ----- static prod (FIXED FOR VITE) -----
function serveStaticProd(app: express.Express) {
  const distDir = path.resolve(PROJECT_ROOT, "dist");
  const indexHtml = path.join(distDir, "index.html");
  const indexHtmlTemplate = fs.readFileSync(indexHtml, "utf-8");

  app.use(express.static(distDir, { maxAge: "1h", etag: true, index: false }));

  app.get("*", async (req, res, next) => {
    if (req.path.startsWith("/api")) return next();

    const configuredBase = (
      process.env.VITE_PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || "https://zleshop.cz"
    ).replace(/\/+$/, "");
    const base = (() => {
      try {
        const parsed = new URL(configuredBase);
        if (/localhost|127\.0\.0\.1|::1/i.test(parsed.hostname)) {
          return "https://zleshop.cz";
        }
        return `${parsed.protocol}//${parsed.host}`;
      } catch {
        return "https://zleshop.cz";
      }
    })();
    const cleanPath = (req.path || "/").replace(/\/+$/, "") || "/";
    const canonicalUrl = `${base}${cleanPath === "/" ? "/" : cleanPath}`;

    const productPathMatch = cleanPath.match(/^\/p\/([^/]+)$/);
    const productId = productPathMatch?.[1] ? decodeURIComponent(productPathMatch[1]) : null;

    let product = null;
    if (productId) {
      try {
        product = await storage.getProduct(productId);
      } catch {
        product = null;
      }
    }

    const productExists = Boolean(productId ? product : true);
    const defaultOgImage = `${base}/images/brand/hero.png`;

    const html = !productId
      ? injectSeo(indexHtmlTemplate, canonicalUrl)
      : productExists && product
        ? (() => {
            const productTitle = buildProductMetaTitle(product);
            const coverPath = `/images/products/${product.id}/cover.jpg`;
            const hasCoverImage = fs.existsSync(path.join(liveProductsRoot, product.id, "cover.jpg"))
              || fs.existsSync(path.join(altLiveProductsRoot, product.id, "cover.jpg"));
            const fallbackImage = (product.image || "").trim();
            const productImage = hasCoverImage
              ? `${base}${coverPath}`
              : /^https?:\/\//i.test(fallbackImage)
                ? fallbackImage
                : /^\//.test(fallbackImage)
                  ? `${base}${fallbackImage}`
                  : defaultOgImage;

            const productDescription = buildProductMetaDescription(product, 158);
            const productSchema = buildProductJsonLd(product, {
              siteUrl: base,
              imageUrl: productImage,
            });
            const seoHtml = injectSeo(indexHtmlTemplate, canonicalUrl, {
              title: productTitle,
              description: productDescription,
              ogTitle: productTitle,
              ogDescription: productDescription,
              ogImage: toAbsoluteUrl(productImage, base),
              ogType: "product",
              twitterCard: "summary_large_image",
              twitterTitle: productTitle,
              twitterDescription: productDescription,
              twitterImage: toAbsoluteUrl(productImage, base),
              ogUrl: canonicalUrl,
            });

            return injectJsonLdScript(seoHtml, "zle-product-schema-ssr", productSchema);
          })()
        : injectSeoWithOptions(indexHtmlTemplate, canonicalUrl, { robots: "noindex, nofollow" });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.status(productExists ? 200 : 404).send(html);
  });
}

// ----- boot -----
(async () => {
  if (!isProd()) printEnvStatus();
  else log("Booting service (production)...", "startup");

  await initStripe();

  if (flags.HAS_DATABASE && !isProd() && flags.SEED_ON_START) {
    try {
      await seedPartners();
    } catch (e) {
      console.error("Partner seeding failed:", e);
    }
  }

  await registerRoutes(app);
  startAbandonedOrderSweeper();

  if (isProd()) {
    serveStaticProd(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, "0.0.0.0", () =>
    log(
      `Server listening on 0.0.0.0:${PORT}`,
      isProd() ? "startup" : "express"
    )
  );

  const shutdown = (signal: string) => {
    log(`Received ${signal}, shutting down...`, "system");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();

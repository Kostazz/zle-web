import "dotenv/config";
import fs from "node:fs";
import path from "path";
import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";

import helmet from "helmet";

import { registerRoutes } from "./routes";
import { isStripeAvailable, disableStripe } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import { seedPartners } from "./payouts";
import { requestIdMiddleware } from "./middleware/requestId";
import { apiLimiter, strictLimiter } from "./middleware/rateLimit";
import { env, flags, printEnvStatus, getHealthData } from "./env";
import { startAbandonedOrderSweeper } from "./jobs/abandonedSweeper";
import { injectSeo } from "./seo/injectSeo";
import { validateRequiredEnv } from "./utils/validateEnv";

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

// ----- static images -----
app.use("/images", express.static(path.join(PROJECT_ROOT, "foto")));

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

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

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

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();

    const base = (
      process.env.VITE_PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || "https://zleshop.cz"
    ).replace(/\/+$/, "");
    const cleanPath = (req.path || "/").replace(/\/+$/, "") || "/";
    const canonicalUrl = `${base}${cleanPath === "/" ? "/" : cleanPath}`;

    const html = injectSeo(indexHtmlTemplate, canonicalUrl);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.send(html);
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

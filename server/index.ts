import "dotenv/config";
import path from "path";
import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";

import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { registerRoutes } from "./routes";
import { isStripeAvailable, disableStripe } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import { seedPartners } from "./payouts";
import { requestIdMiddleware } from "./middleware/requestId";
import { env, flags, printEnvStatus, getHealthData } from "./env";

const app = express();
app.disable("x-powered-by");

// Project root (CJS build output)
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

if (isProd()) {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// ----- rate limits -----
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd() ? 150 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
});

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProd() ? 10 : 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/stripe/create-checkout-session", checkoutLimiter);
app.use("/api/checkout", checkoutLimiter);
app.use("/api/admin", apiLimiter);

// ----- health -----
app.get("/health", (_req, res) => res.json(getHealthData()));
app.get("/api/health", (_req, res) => res.json(getHealthData()));

// ----- Stripe webhook (raw) -----
app.post(
  "/api/stripe/webhook/:uuid",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!flags.ENABLE_STRIPE) return res.status(503).json({ error: "Stripe disabled" });

    const signature = req.headers["stripe-signature"];
    if (!signature) return res.status(400).json({ error: "Missing stripe-signature" });

    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;

      if (!Buffer.isBuffer(req.body)) {
        return res.status(500).json({ error: "Webhook processing error" });
      }

      await WebhookHandlers.processWebhook(req.body, sig, req.params.uuid);
      return res.status(200).json({ received: true });
    } catch {
      return res.status(400).json({ error: "Webhook processing error" });
    }
  }
);

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
      // ⛔ ignore expected auth noise
      if (p === "/api/auth/user" && status === 401) return;

      // log only real problems
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

// ----- static prod -----
function serveStaticProd(app: express.Express) {
  const publicDir = path.resolve(PROJECT_ROOT, "dist", "public");
  const indexHtml = path.join(publicDir, "index.html");

  app.use(express.static(publicDir, { maxAge: "1h", etag: true, index: false }));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(indexHtml);
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

  if (isProd()) serveStaticProd(app);
  else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, "0.0.0.0", () =>
    log(`Server listening on 0.0.0.0:${PORT}`, isProd() ? "startup" : "express")
  );

  const shutdown = (signal: string) => {
    log(`Received ${signal}, shutting down...`, "system");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();

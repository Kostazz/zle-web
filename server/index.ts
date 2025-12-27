import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrations } from 'stripe-replit-sync';
import { getStripeSync, isStripeAvailable, disableStripe } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { seedPartners } from "./payouts";
import { requestIdMiddleware } from "./middleware/requestId";
import { env, flags, printEnvStatus, getHealthData } from "./env";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Initialize Stripe (only if enabled and configured)
async function initStripe() {
  if (!flags.ENABLE_STRIPE) {
    log("Stripe disabled via ENABLE_STRIPE=false", "stripe");
    disableStripe();
    return;
  }

  if (!flags.HAS_DATABASE) {
    log("Stripe disabled - DATABASE_URL not set", "stripe");
    disableStripe();
    return;
  }

  if (!isStripeAvailable()) {
    log("Stripe credentials not available - payments disabled", "stripe");
    disableStripe();
    return;
  }

  try {
    log("Initializing Stripe schema...", "stripe");
    await runMigrations({ databaseUrl: env.DATABASE_URL! });
    log("Stripe schema ready", "stripe");

    const stripeSync = await getStripeSync();

    // Set up managed webhook (only on Replit with domains)
    if (env.REPLIT_DOMAINS) {
      log("Setting up managed webhook...", "stripe");
      const webhookBaseUrl = `https://${env.REPLIT_DOMAINS.split(",")[0]}`;
      const { webhook, uuid } = await stripeSync.findOrCreateManagedWebhook(
        `${webhookBaseUrl}/api/stripe/webhook`,
        {
          enabled_events: [
            "checkout.session.completed",
            "payment_intent.succeeded",
            "payment_intent.payment_failed",
          ],
          description: "ZLE e-commerce webhook",
        }
      );
      log(`Webhook configured: ${webhook.url} (UUID: ${uuid})`, "stripe");
    }

    // Sync Stripe data in background
    log("Syncing Stripe data...", "stripe");
    stripeSync
      .syncBackfill()
      .then(() => log("Stripe data synced", "stripe"))
      .catch((err: Error) => console.error("Error syncing Stripe data:", err));
  } catch (error) {
    console.error("Failed to initialize Stripe:", error);
    disableStripe();
  }
}

// Health endpoint - always available
app.get("/health", (_req, res) => {
  res.json(getHealthData());
});

app.get("/api/health", (_req, res) => {
  res.json(getHealthData());
});

// Register Stripe webhook route BEFORE express.json()
app.post(
  "/api/stripe/webhook/:uuid",
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
        console.error("Webhook body is not a Buffer");
        return res.status(500).json({ error: "Webhook processing error" });
      }

      const { uuid } = req.params;
      await WebhookHandlers.processWebhook(req.body as Buffer, sig, uuid);

      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error("Webhook error:", error.message);
      res.status(400).json({ error: "Webhook processing error" });
    }
  }
);

// Request ID middleware
app.use(requestIdMiddleware);

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

const isProduction = env.NODE_ENV === "production";
if (isProduction) {
  app.set("trust proxy", 1);
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 100 : 1000,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProduction ? 10 : 100,
  message: { error: "Too many checkout attempts, please try again later." },
});

app.use("/api/stripe/create-checkout-session", checkoutLimiter);
app.use("/api/checkout", checkoutLimiter);
app.use("/api/admin", apiLimiter);

// JSON middleware
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.urlencoded({ extended: false }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  // Print environment status table
  printEnvStatus();

  // Initialize Stripe (if enabled)
  await initStripe();

  // Seed partners (only if DB available and SEED_ON_START enabled)
  if (flags.HAS_DATABASE) {
    if (flags.SEED_ON_START) {
      log("Seeding partners (SEED_ON_START=true)...", "db");
      try {
        await seedPartners();
        log("Partner seeding complete", "db");
      } catch (error) {
        console.error("Partner seeding failed:", error);
      }
    } else {
      // Always seed partners for now (existing behavior)
      try {
        await seedPartners();
      } catch (error) {
        console.error("Partner seeding failed (non-fatal):", error);
      }
    }
  } else {
    log("Skipping partner seeding - no database", "db");
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  // Setup Vite in development, static serving in production
  if (isProduction) {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  httpServer.listen(
    {
      port: env.PORT,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${env.PORT}`);
    }
  );
})();

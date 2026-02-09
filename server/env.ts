import crypto from "crypto";

// Helper to check truthy env values
export function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

// Generate ephemeral dev secret if SESSION_SECRET missing
function getSessionSecret(): string {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }
  const ephemeral = crypto.randomBytes(32).toString("hex");
  console.warn("[env] SESSION_SECRET missing - using ephemeral dev secret (sessions will not persist across restarts)");
  return ephemeral;
}

// Detect environment
const isDev = process.env.NODE_ENV !== "production";
const isReplit = Boolean(process.env.REPL_ID);

// Feature flags with smart defaults
export const flags = {
  // Auth: enabled on Replit by default, disabled elsewhere unless explicitly enabled
  ENABLE_AUTH: isReplit || isTruthy(process.env.ENABLE_AUTH),

  // Stripe: enabled if key exists and not explicitly disabled
  ENABLE_STRIPE:
    process.env.ENABLE_STRIPE !== "false" &&
    Boolean(process.env.STRIPE_SECRET_KEY || (isReplit && (process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL))),

  // Email: enabled if RESEND_API_KEY exists (prod) OR on Replit (connector)
  ENABLE_EMAIL: process.env.ENABLE_EMAIL !== "false" && (Boolean(process.env.RESEND_API_KEY) || isReplit),

  // OPS webhooks: disabled by default in dev
  ENABLE_OPS: isTruthy(process.env.ENABLE_OPS),

  // Seed on start: disabled by default
  SEED_ON_START: isTruthy(process.env.SEED_ON_START),

  // DB available
  HAS_DATABASE: Boolean(process.env.DATABASE_URL),
};

// Validated environment values
export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "5000", 10),
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: getSessionSecret(),

  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  // Optional hardening for the webhook route: /api/stripe/webhook/:uuid
  STRIPE_WEBHOOK_UUID: process.env.STRIPE_WEBHOOK_UUID,

  // Email
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  // IMPORTANT (production): must be on a VERIFIED domain in Resend
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  FULFILLMENT_EMAIL_TO: process.env.FULFILLMENT_EMAIL_TO,

  // Exports (accounting)
  EXPORT_TOKEN: process.env.EXPORT_TOKEN,

  // OPS
  OPS_TOKEN: process.env.OPS_TOKEN,
  OPS_WEBHOOK_URL: process.env.OPS_WEBHOOK_URL,
  OPS_WEBHOOK_SECRET: process.env.OPS_WEBHOOK_SECRET,
  OPS_EMAIL_TO: process.env.OPS_EMAIL_TO,

  // Cron / jobs
  DAILY_LINE_CRON_SECRET: process.env.DAILY_LINE_CRON_SECRET,
  DAILY_LINE_ENABLE: process.env.DAILY_LINE_ENABLE,
  ABANDONED_ORDER_TTL_MINUTES: process.env.ABANDONED_ORDER_TTL_MINUTES,
  ABANDONED_SWEEP_INTERVAL_MS: process.env.ABANDONED_SWEEP_INTERVAL_MS,
  ABANDONED_SWEEP_RUN_ON_BOOT: process.env.ABANDONED_SWEEP_RUN_ON_BOOT,

  // Client URL (optional)
  PUBLIC_URL: process.env.PUBLIC_URL,

  // Dev helpers
  IS_DEV: isDev,
  IS_REPLIT: isReplit,
};

// --- Missing exports used by server/index.ts ---

export function getHealthData() {
  return {
    ok: true,
    env: env.NODE_ENV,
    now: new Date().toISOString(),
    flags: {
      ENABLE_AUTH: flags.ENABLE_AUTH,
      ENABLE_STRIPE: flags.ENABLE_STRIPE,
      ENABLE_EMAIL: flags.ENABLE_EMAIL,
      ENABLE_OPS: flags.ENABLE_OPS,
      HAS_DATABASE: flags.HAS_DATABASE,
      SEED_ON_START: flags.SEED_ON_START,
    },
    has: {
      STRIPE_SECRET_KEY: Boolean(env.STRIPE_SECRET_KEY),
      STRIPE_WEBHOOK_SECRET: Boolean(env.STRIPE_WEBHOOK_SECRET),
      RESEND_API_KEY: Boolean(env.RESEND_API_KEY),
      RESEND_FROM_EMAIL: Boolean(env.RESEND_FROM_EMAIL),
      FULFILLMENT_EMAIL_TO: Boolean(env.FULFILLMENT_EMAIL_TO),
      DATABASE_URL: Boolean(env.DATABASE_URL),
    },
  };
}

export function printEnvStatus() {
  const h = getHealthData();
  console.log("[env] status", {
    env: h.env,
    flags: h.flags,
    has: h.has,
  });
}

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
  ENABLE_STRIPE: process.env.ENABLE_STRIPE !== "false" && Boolean(
    process.env.STRIPE_SECRET_KEY ||
    (isReplit && (process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL))
  ),

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
  // If set, the incoming :uuid must match this value.
  STRIPE_WEBHOOK_UUID: process.env.STRIPE_WEBHOOK_UUID,

  // Email
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  FULFILLMENT_EMAIL_TO: process.env.FULFILLMENT_EMAIL_TO,

  // Exports (accounting)
  EXPORT_TOKEN: process.env.EXPORT_TOKEN,

  // OPS
  OPS_WEBHOOK_URL: process.env.OPS_WEBHOOK_URL,
  OPS_EMAIL_TO: process.env.OPS_EMAIL_TO,

  // Replit auth
  REPL_ID: process.env.REPL_ID,
  REPLIT_DOMAINS: process.env.REPLIT_DOMAINS,

  // Computed
  isDev,
  isReplit,
};

// Print startup status table
export function printEnvStatus(): void {
  const status = (enabled: boolean, configured: boolean) => {
    if (!enabled) return "disabled";
    return configured ? "enabled ✓" : "enabled but missing config ⚠";
  };

  console.log("\n┌─────────────────────────────────────────┐");
  console.log("│           ZLE Environment Status         │");
  console.log("├─────────────────────────────────────────┤");
  console.log(`│  Mode:     ${env.isDev ? "development" : "production"}`.padEnd(42) + "│");
  console.log(`│  Platform: ${env.isReplit ? "Replit" : "Local/Codespaces"}`.padEnd(42) + "│");
  console.log("├─────────────────────────────────────────┤");
  console.log(`│  Database: ${flags.HAS_DATABASE ? "configured ✓" : "not configured ⚠"}`.padEnd(42) + "│");
  console.log(`│  Auth:     ${status(flags.ENABLE_AUTH, Boolean(env.REPL_ID))}`.padEnd(42) + "│");
  console.log(`│  Stripe:   ${status(flags.ENABLE_STRIPE, Boolean(env.STRIPE_SECRET_KEY) || env.isReplit)}`.padEnd(42) + "│");
  console.log(`│  Email:    ${status(flags.ENABLE_EMAIL, Boolean(env.RESEND_API_KEY))}`.padEnd(42) + "│");
  console.log(`│  OPS:      ${status(flags.ENABLE_OPS, Boolean(env.OPS_WEBHOOK_URL))}`.padEnd(42) + "│");
  console.log("└─────────────────────────────────────────┘\n");

  // Warnings for common issues
  if (!flags.HAS_DATABASE) {
    console.warn("[env] ⚠ DATABASE_URL not set - running in no-db mode (limited functionality)");
  }
  if (flags.ENABLE_AUTH && !env.REPL_ID) {
    console.warn("[env] ⚠ ENABLE_AUTH=true but REPL_ID missing - auth will be disabled");
  }
  if (flags.ENABLE_STRIPE && !env.STRIPE_SECRET_KEY && !env.isReplit) {
    console.warn("[env] ⚠ ENABLE_STRIPE=true but STRIPE_SECRET_KEY missing - payments disabled");
  }
}

// Health check data
export function getHealthData() {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    flags: {
      auth: flags.ENABLE_AUTH && Boolean(env.REPL_ID),
      stripe: flags.ENABLE_STRIPE,
      email: flags.ENABLE_EMAIL,
      ops: flags.ENABLE_OPS,
      database: flags.HAS_DATABASE,
    },
  };
}

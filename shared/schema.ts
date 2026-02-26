import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb, index, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  isAdmin: boolean("is_admin").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  // RBAC + 2FA skeleton (ZLE v1.2.2)
  role: text("role").default("user"), // "admin" | "staff" | "read_only" | "user"
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorSecret: text("two_factor_secret"), // encrypted/encoded TOTP secret
  twoFactorRecoveryCodes: text("two_factor_recovery_codes"), // hashed recovery codes
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export const products = pgTable("products", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  price: integer("price").notNull(),
  sizes: text("sizes").array().notNull(),
  image: text("image").notNull(),
  images: text("images").array(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  stock: integer("stock").notNull().default(100),
  isActive: boolean("is_active").default(true),
  // Waterfall payout fields (ZLE v1.2.2)
  productModel: text("product_model").default("legacy"), // "legacy" | "new"
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }), // COGS per unit
  stockOwner: text("stock_owner"), // "MICHAL" | "ZLE" | null
  pricingMode: text("pricing_mode"), // future: "fixed" | "margin_percent"
  pricingPercent: numeric("pricing_percent", { precision: 5, scale: 2 }), // future
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
});

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

export const paymentMethodEnum = z.enum([
  "card",
  "bank",
  "cod",
  "in_person",
  "gpay",
  "applepay",
  "usdc",
  "btc",
  "eth",
  "sol",
  "pi",
]);

export type PaymentMethod = z.infer<typeof paymentMethodEnum>;

export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accessToken: varchar("access_token", { length: 64 }).unique(),
  userId: varchar("user_id").references(() => users.id),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerAddress: text("customer_address").notNull(),
  customerCity: text("customer_city").notNull(),
  customerZip: text("customer_zip").notNull(),
  items: text("items").notNull(),
  total: integer("total").notNull(),
  netTotal: numeric("net_total", { precision: 12, scale: 2 }),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }),
  vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("pending"),
  paymentStatus: text("payment_status").default("unpaid"),
  paymentIntentId: text("payment_intent_id"),
  paymentMethod: text("payment_method").default("card"),
  paymentNetwork: text("payment_network"),
  fingerprint: text("fingerprint"),
  fingerprintCreatedAt: timestamp("fingerprint_created_at"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripeCheckoutSessionCreatedAt: timestamp("stripe_checkout_session_created_at"),
  createdAt: timestamp("created_at").defaultNow(),
  // Waterfall payout fields (ZLE v1.2.2)
  cogsTotal: numeric("cogs_total", { precision: 12, scale: 2 }),
  feesTotal: numeric("fees_total", { precision: 12, scale: 2 }),
  distributableTotal: numeric("distributable_total", { precision: 12, scale: 2 }),
  payoutBasis: text("payout_basis").default("distributable"), // "gross" | "distributable"
  // Fraud/review fields (ZLE v1.2.2)
  riskScore: numeric("risk_score", { precision: 5, scale: 2 }),
  manualReview: boolean("manual_review").default(false),
  fraudNotes: text("fraud_notes"),
  opsNotes: text("ops_notes"),
  // Stock tracking (ZLE v1.2.3)
  stockDeductedAt: timestamp("stock_deducted_at"),
  // Refund/returns fields (ZLE v1.2.2)
  withdrawalDeadlineAt: timestamp("withdrawal_deadline_at"),
  refundAmount: numeric("refund_amount", { precision: 12, scale: 2 }),
  refundReason: text("refund_reason"),
}, (table) => [
  index("IDX_orders_fingerprint").on(table.fingerprint),
]);

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  status: true,
  paymentStatus: true,
  paymentIntentId: true,
  createdAt: true,
});

export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;

export const addresses = pgTable("addresses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  zip: text("zip").notNull(),
  isDefault: boolean("is_default").default(false),
});

export const insertAddressSchema = createInsertSchema(addresses).omit({
  id: true,
});

export type InsertAddress = z.infer<typeof insertAddressSchema>;
export type Address = typeof addresses.$inferSelect;

export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
  addresses: many(addresses),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
}));

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, {
    fields: [addresses.userId],
    references: [users.id],
  }),
}));

export const cartItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  price: z.number(),
  size: z.string(),
  quantity: z.number(),
  image: z.string(),
});

export type CartItem = z.infer<typeof cartItemSchema>;

export const crewMemberSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  vibe: z.string(),
  image: z.string(),
});

export type CrewMember = z.infer<typeof crewMemberSchema>;

export const storyItemSchema = z.object({
  id: z.string(),
  year: z.string(),
  title: z.string(),
  description: z.string(),
  image: z.string(),
});

export type StoryItem = z.infer<typeof storyItemSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// EU ACCOUNTING + PAYOUT TABLES (ZLE EU + OPS PACK v1.0)
// ═══════════════════════════════════════════════════════════════════════════

export const partners = pgTable("partners", {
  code: varchar("code", { length: 50 }).primaryKey(),
  displayName: text("display_name").notNull(),
  type: text("type").notNull().default("person"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Partner = typeof partners.$inferSelect;
export type InsertPartner = typeof partners.$inferInsert;

export const payoutRules = pgTable("payout_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  validFrom: timestamp("valid_from").defaultNow(),
  scope: text("scope").notNull().default("order"),
  partnerCode: varchar("partner_code", { length: 50 }).notNull().references(() => partners.code),
  percent: numeric("percent", { precision: 5, scale: 2 }).notNull(),
  priority: integer("priority").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PayoutRule = typeof payoutRules.$inferSelect;
export type InsertPayoutRule = typeof payoutRules.$inferInsert;

export const orderPayouts = pgTable("order_payouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.id),
  partnerCode: varchar("partner_code", { length: 50 }).notNull(),
  ruleId: varchar("rule_id"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("CZK"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  paidAt: timestamp("paid_at"),
});

export type OrderPayout = typeof orderPayouts.$inferSelect;
export type InsertOrderPayout = typeof orderPayouts.$inferInsert;

export const ledgerEntries = pgTable("ledger_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id"),
  type: text("type").notNull(),
  direction: text("direction").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("CZK"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at").defaultNow(),
  // Dedupe key for preventing duplicate entries (ZLE v1.2.3)
  dedupeKey: varchar("dedupe_key", { length: 255 }), // e.g. "sale:<orderId>" for unique constraint
}, (table) => [
  index("IDX_ledger_order_id").on(table.orderId),
  index("IDX_ledger_created_at").on(table.createdAt),
  uniqueIndex("UQ_ledger_dedupe_key").on(table.dedupeKey),
]);

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type InsertLedgerEntry = typeof ledgerEntries.$inferInsert;

export const auditLog = pgTable("audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actorUserId: varchar("actor_user_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: varchar("entity_id"),
  meta: jsonb("meta"),
  severity: text("severity").default("info"), // "info" | "warning" | "important" | "critical"
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_audit_created_at").on(table.createdAt),
]);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLogEntry = typeof auditLog.$inferInsert;

export const gdprRetention = pgTable("gdpr_retention", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dataType: text("data_type").notNull(),
  retentionDays: integer("retention_days").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type GdprRetention = typeof gdprRetention.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// ORDER EVENTS - GUARANTEED IDEMPOTENCY (ZLE v1.2.2)
// ═══════════════════════════════════════════════════════════════════════════

export const orderEvents = pgTable("order_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").references(() => orders.id),
  provider: text("provider").notNull(), // "stripe" | "crypto" | "manual" | etc.
  providerEventId: text("provider_event_id").notNull(), // unique per provider
  type: text("type").notNull(), // "payment_succeeded" | "payment_failed" | "refund" | "chargeback" | etc.
  payloadHash: text("payload_hash"), // hash of payload for verification
  payload: jsonb("payload"), // minimal/redacted payload
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("UQ_order_event_provider").on(table.provider, table.providerEventId),
  index("IDX_order_event_order").on(table.orderId, table.createdAt),
]);

export type OrderEvent = typeof orderEvents.$inferSelect;
export type InsertOrderEvent = typeof orderEvents.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// ORDER IDEMPOTENCY KEYS (ZLE v1.2.4)
// ═══════════════════════════════════════════════════════════════════════════

export const orderIdempotencyKeys = pgTable("order_idempotency_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
  orderId: varchar("order_id").references(() => orders.id),
  paymentMethod: text("payment_method"),
  stripeSessionId: text("stripe_session_id"),
  stripeSessionUrl: text("stripe_session_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("UQ_order_idempotency_key").on(table.idempotencyKey),
  index("IDX_order_idempotency_order").on(table.orderId),
]);

export type OrderIdempotencyKey = typeof orderIdempotencyKeys.$inferSelect;
export type InsertOrderIdempotencyKey = typeof orderIdempotencyKeys.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// CONSENTS LOG - GDPR COOKIES/MARKETING (ZLE v1.2.2)
// ═══════════════════════════════════════════════════════════════════════════

export const consents = pgTable("consents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  sessionId: varchar("session_id"),
  consentType: text("consent_type").notNull(), // "essential" | "analytics" | "marketing"
  status: text("status").notNull(), // "granted" | "denied"
  policyVersion: text("policy_version").notNull(),
  source: text("source").notNull().default("banner"), // "banner" | "settings" | "import"
  ipHash: text("ip_hash"), // hashed/truncated IP if stored
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Consent = typeof consents.$inferSelect;
export type InsertConsent = typeof consents.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT PROVIDERS - CRYPTO-READY, DISABLED BY DEFAULT (ZLE v1.2.2)
// ═══════════════════════════════════════════════════════════════════════════

export const paymentProviders = pgTable("payment_providers", {
  id: varchar("id").primaryKey(), // "stripe_card", "stripe_gpay", "crypto_btc", etc.
  displayName: text("display_name").notNull(),
  type: text("type").notNull(), // "fiat" | "crypto"
  enabled: boolean("enabled").default(false),
  config: jsonb("config"), // provider-specific config (redacted in prod)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type PaymentProvider = typeof paymentProviders.$inferSelect;
export type InsertPaymentProvider = typeof paymentProviders.$inferInsert;

// Crypto assets for future use
export const cryptoAssets = pgTable("crypto_assets", {
  id: varchar("id").primaryKey(), // "BTC", "ETH", "SOL", "USDC", "PI"
  displayName: text("display_name").notNull(),
  networks: text("networks").array(), // chain identifiers
  enabled: boolean("enabled").default(false),
  minConfirmations: integer("min_confirmations").default(1),
  manualReviewRequired: boolean("manual_review_required").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CryptoAsset = typeof cryptoAssets.$inferSelect;
export type InsertCryptoAsset = typeof cryptoAssets.$inferInsert;

// Crypto receiving addresses (rotatable)
export const cryptoAddresses = pgTable("crypto_addresses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assetId: varchar("asset_id").notNull().references(() => cryptoAssets.id),
  network: text("network").notNull(),
  address: text("address").notNull(),
  isActive: boolean("is_active").default(true),
  usedForOrderId: varchar("used_for_order_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CryptoAddress = typeof cryptoAddresses.$inferSelect;
export type InsertCryptoAddress = typeof cryptoAddresses.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// DAILY LINES (ZLE Daily Line Engine v1.0) — 1 line per day, idempotent by date
// ═══════════════════════════════════════════════════════════════════════════

export const dailyLines = pgTable(
  "daily_lines",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

    // ukládáme YYYY-MM-DD v Europe/Prague
    date: text("date").notNull(),

    text: text("text").notNull(),
    mode: text("mode").notNull().default("daily"),
    seed: text("seed"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    dailyLinesDateUnique: uniqueIndex("daily_lines_date_unique").on(t.date),
  })
);

export type DailyLine = typeof dailyLines.$inferSelect;
export type InsertDailyLine = typeof dailyLines.$inferInsert;

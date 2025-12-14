import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb, index, numeric } from "drizzle-orm/pg-core";
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
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
});

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

export const paymentMethodEnum = z.enum([
  "card",
  "bank",
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
  createdAt: timestamp("created_at").defaultNow(),
});

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
});

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type InsertLedgerEntry = typeof ledgerEntries.$inferInsert;

export const auditLog = pgTable("audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actorUserId: varchar("actor_user_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: varchar("entity_id"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at").defaultNow(),
});

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

import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Product schema for ZLE merch
export const products = pgTable("products", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  price: integer("price").notNull(),
  sizes: text("sizes").array().notNull(),
  image: text("image").notNull(),
  images: text("images").array(),
  category: text("category").notNull(),
  description: text("description").notNull(),
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
});

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

// Order schema for checkout
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerAddress: text("customer_address").notNull(),
  customerCity: text("customer_city").notNull(),
  customerZip: text("customer_zip").notNull(),
  items: text("items").notNull(), // JSON string of cart items
  total: integer("total").notNull(),
  status: text("status").notNull().default("pending"),
});

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  status: true,
});

export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;

// Cart item type (frontend only)
export const cartItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  price: z.number(),
  size: z.string(),
  quantity: z.number(),
  image: z.string(),
});

export type CartItem = z.infer<typeof cartItemSchema>;

// Crew member type
export const crewMemberSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  vibe: z.string(),
  image: z.string(),
});

export type CrewMember = z.infer<typeof crewMemberSchema>;

// Story item type
export const storyItemSchema = z.object({
  id: z.string(),
  year: z.string(),
  title: z.string(),
  description: z.string(),
  image: z.string(),
});

export type StoryItem = z.infer<typeof storyItemSchema>;

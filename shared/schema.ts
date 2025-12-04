import { sql, relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  integer,
  text,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Order status enum
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "paid",
  "uploaded",
  "processing",
  "complete",
]);

// File type enum
export const fileTypeEnum = pgEnum("file_type", ["input", "output"]);

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

// Users table for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  isAdmin: integer("is_admin").default(0),
  passwordHash: varchar("password_hash"),
  passwordSalt: varchar("password_salt"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Orders table
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  sheetCount: integer("sheet_count").notNull(),
  totalPriceSar: integer("total_price_sar").notNull(),
  status: orderStatusEnum("status").notNull().default("pending"),
  stripeSessionId: varchar("stripe_session_id"),
  stripePaymentIntentId: varchar("stripe_payment_intent_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  paidAt: timestamp("paid_at"),
  uploadedAt: timestamp("uploaded_at"),
  completedAt: timestamp("completed_at"),
});

// Files table
export const files = pgTable("files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.id),
  fileType: fileTypeEnum("file_type").notNull(),
  fileName: varchar("file_name").notNull(),
  fileSize: integer("file_size"),
  storageKey: varchar("storage_key").notNull(),
  mimeType: varchar("mime_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

// API Keys table for Revit add-in authentication
export const apiKeys = pgTable("api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: varchar("name").notNull(),
  keyHash: varchar("key_hash").notNull(),
  lastUsed: timestamp("last_used"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Add-in sessions table for password-based authentication
export const addinSessions = pgTable("addin_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  tokenHash: varchar("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  deviceLabel: varchar("device_label"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
  apiKeys: many(apiKeys),
  addinSessions: many(addinSessions),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export const addinSessionsRelations = relations(addinSessions, ({ one }) => ({
  user: one(users, {
    fields: [addinSessions.userId],
    references: [users.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  files: many(files),
}));

export const filesRelations = relations(files, ({ one }) => ({
  order: one(orders, {
    fields: [files.orderId],
    references: [orders.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  paidAt: true,
  uploadedAt: true,
  completedAt: true,
});

export const insertFileSchema = createInsertSchema(files).omit({
  id: true,
  createdAt: true,
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  createdAt: true,
  lastUsed: true,
});

export const insertAddinSessionSchema = createInsertSchema(addinSessions).omit({
  id: true,
  createdAt: true,
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertFile = z.infer<typeof insertFileSchema>;
export type File = typeof files.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertAddinSession = z.infer<typeof insertAddinSessionSchema>;
export type AddinSession = typeof addinSessions.$inferSelect;

// API request/response types
export const createOrderRequestSchema = z.object({
  sheetCount: z.number().min(1).max(1000),
});

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

export const orderWithFilesSchema = z.object({
  id: z.string(),
  userId: z.string(),
  sheetCount: z.number(),
  totalPriceSar: z.number(),
  status: z.enum(["pending", "paid", "uploaded", "processing", "complete"]),
  stripeSessionId: z.string().nullable(),
  stripePaymentIntentId: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
  paidAt: z.date().nullable(),
  uploadedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  user: z.object({
    id: z.string(),
    email: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    profileImageUrl: z.string().nullable(),
  }).optional(),
  files: z.array(z.object({
    id: z.string(),
    orderId: z.string(),
    fileType: z.enum(["input", "output"]),
    fileName: z.string(),
    fileSize: z.number().nullable(),
    storageKey: z.string(),
    mimeType: z.string().nullable(),
    createdAt: z.date().nullable(),
  })).optional(),
});

export type OrderWithFiles = z.infer<typeof orderWithFilesSchema>;

// Price per sheet in SAR
export const PRICE_PER_SHEET_SAR = 150;

import { sql, relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  integer,
  bigint,
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
  moyasarPaymentId: varchar("moyasar_payment_id"),
  moyasarInvoiceId: varchar("moyasar_invoice_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  paidAt: timestamp("paid_at"),
  uploadedAt: timestamp("uploaded_at"),
  completedAt: timestamp("completed_at"),
});

// ... (files, orderSheets, apiKeys, addinSessions, passwordResetTokens)

// ...

export const orderWithFilesSchema = z.object({
  id: z.string(),
  userId: z.string(),
  sheetCount: z.number(),
  totalPriceSar: z.number(),
  status: z.enum(["pending", "paid", "uploaded", "processing", "complete"]),
  moyasarPaymentId: z.string().nullable(),
  moyasarInvoiceId: z.string().nullable(),
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
  sheets: z.array(z.object({
    id: z.string(),
    orderId: z.string(),
    sheetElementId: z.string(),
    sheetNumber: z.string(),
    sheetName: z.string(),
    createdAt: z.date().nullable(),
  })).optional(),
});

export type OrderWithFiles = z.infer<typeof orderWithFilesSchema>;

// ============================================
// ACCOUNT BALANCE & COMPANY SCHEMA
// ============================================

// Company accounts
export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  balanceSar: integer("balance_sar").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Company membership (many-to-many: users ↔ companies)
export const companyMembers = pgTable("company_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  role: varchar("role").notNull().default("member"), // 'admin' | 'member'
  createdAt: timestamp("created_at").defaultNow(),
});

// Balance transactions (for both personal and company)
export const balanceTransactions = pgTable("balance_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // If companyId is null, it's a personal transaction
  companyId: varchar("company_id").references(() => companies.id),
  // The user who initiated the transaction
  userId: varchar("user_id").notNull().references(() => users.id),
  type: varchar("type").notNull(), // 'topup' | 'debit' | 'refund_request' | 'refund_approved'
  amountSar: integer("amount_sar").notNull(), // Positive for credit, negative for debit
  orderId: varchar("order_id").references(() => orders.id),
  moyasarPaymentId: varchar("moyasar_payment_id"),
  status: varchar("status").notNull().default("completed"), // 'pending' | 'completed' | 'rejected'
  note: text("note"),
  approvedBy: varchar("approved_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Personal balance table (1:1 with users)
// Ideally this could be on the user table, but separate table is cleaner for migration
export const userBalances = pgTable("user_balances", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  balanceSar: integer("balance_sar").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations
export const companiesRelations = relations(companies, ({ many }) => ({
  members: many(companyMembers),
  transactions: many(balanceTransactions),
}));

export const companyMembersRelations = relations(companyMembers, ({ one }) => ({
  company: one(companies, {
    fields: [companyMembers.companyId],
    references: [companies.id],
  }),
  user: one(users, {
    fields: [companyMembers.userId],
    references: [users.id],
  }),
}));

export const balanceTransactionsRelations = relations(balanceTransactions, ({ one }) => ({
  user: one(users, {
    fields: [balanceTransactions.userId],
    references: [users.id],
  }),
  company: one(companies, {
    fields: [balanceTransactions.companyId],
    references: [companies.id],
  }),
  order: one(orders, {
    fields: [balanceTransactions.orderId],
    references: [orders.id],
  }),
}));

export const userBalancesRelations = relations(userBalances, ({ one }) => ({
  user: one(users, {
    fields: [userBalances.userId],
    references: [users.id],
  }),
}));

// Insert schemas
export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCompanyMemberSchema = createInsertSchema(companyMembers).omit({
  id: true,
  createdAt: true,
});

export const insertBalanceTransactionSchema = createInsertSchema(balanceTransactions).omit({
  id: true,
  createdAt: true,
});

// Types
export type Company = typeof companies.$inferSelect;
export type CompanyMember = typeof companyMembers.$inferSelect;
export type BalanceTransaction = typeof balanceTransactions.$inferSelect;
export type UserBalance = typeof userBalances.$inferSelect;

// Price per sheet in SAR
export const PRICE_PER_SHEET_SAR = 150;

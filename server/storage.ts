import {
  users,
  orders,
  files,
  orderSheets,
  apiKeys,
  addinSessions,
  passwordResetTokens,
  type User,
  type UpsertUser,
  type Order,
  type InsertOrder,
  type File as FileRecord,
  type InsertFile,
  type OrderWithFiles,
  type ApiKey,
  type InsertApiKey,
  type AddinSession,
  type OrderSheet,
  type SheetInfo,
  type Company,
  type CompanyMember,
  type InsertCompanyMember,
  companies,
  companyMembers,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, lt } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcryptjs";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getUsersWithOrderStats(): Promise<Array<User & { orderCount: number; totalSpent: number }>>;

  // Order operations
  createOrder(order: InsertOrder): Promise<Order>;
  createOrderWithSheets(order: InsertOrder, sheets: SheetInfo[]): Promise<Order>;
  getOrder(id: string): Promise<Order | undefined>;
  getOrderWithFiles(id: string): Promise<OrderWithFiles | undefined>;
  getOrdersByUserId(userId: string): Promise<OrderWithFiles[]>;
  getAllOrders(): Promise<OrderWithFiles[]>;
  updateOrder(id: string, data: Partial<Order>): Promise<Order | undefined>;
  updateOrderStatus(id: string, status: Order["status"]): Promise<Order | undefined>;

  // File operations
  createFile(file: InsertFile): Promise<FileRecord>;
  getFile(id: string): Promise<FileRecord | undefined>;
  getFilesByOrderId(orderId: string): Promise<FileRecord[]>;

  // Order sheet operations
  createOrderSheets(orderId: string, sheets: SheetInfo[]): Promise<OrderSheet[]>;
  getOrderSheets(orderId: string): Promise<OrderSheet[]>;

  // API Key operations
  createApiKey(userId: string, name: string): Promise<{ apiKey: ApiKey; rawKey: string }>;
  getApiKeysByUserId(userId: string): Promise<ApiKey[]>;
  validateApiKey(rawKey: string): Promise<User | null>;
  deleteApiKey(id: string, userId: string): Promise<boolean>;
  updateApiKeyLastUsed(id: string): Promise<void>;

  // Password-based auth operations
  getUserByEmail(email: string): Promise<User | null>;
  createUserWithPassword(email: string, passwordHash: string, firstName?: string, lastName?: string): Promise<User>;
  validateUserPassword(email: string, password: string): Promise<User | null>;
  setUserPassword(userId: string, passwordHash: string): Promise<User | null>;
  changeUserPassword(userId: string, currentPassword: string, newPasswordHash: string): Promise<{ success: boolean; error?: string }>;

  // Add-in session operations
  createAddinSession(userId: string, rawToken: string, deviceLabel?: string): Promise<{ session: AddinSession; rawToken: string }>;
  validateAddinSession(rawToken: string): Promise<User | null>;
  deleteAddinSession(rawToken: string): Promise<boolean>;

  // Password reset token operations
  createPasswordResetToken(userId: string): Promise<string>;
  validatePasswordResetToken(rawToken: string): Promise<User | null>;
  usePasswordResetToken(rawToken: string, newPasswordHash: string): Promise<boolean>;

  // Company operations
  createCompany(name: string, ownerId: string): Promise<Company>;
  getCompany(companyId: string): Promise<Company | undefined>;
  getCompanyMembers(companyId: string): Promise<CompanyMember[]>;
  addCompanyMember(companyId: string, email: string, role?: string): Promise<void>; // Simplified to use email logic internally
  removeCompanyMember(companyId: string, userId: string): Promise<void>;
  updateCompanyBalance(companyId: string, amount: number): Promise<void>;
  getPendingRefundRequests(): Promise<any[]>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getUsersWithOrderStats(): Promise<Array<User & { orderCount: number; totalSpent: number }>> {
    const result = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
        isAdmin: users.isAdmin,
        passwordHash: users.passwordHash,
        passwordSalt: users.passwordSalt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        orderCount: sql<number>`COALESCE(COUNT(${orders.id}), 0)::int`,
        totalSpent: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} != 'pending' THEN ${orders.totalPriceSar} ELSE 0 END), 0)::int`,
      })
      .from(users)
      .leftJoin(orders, eq(users.id, orders.userId))
      .where(eq(users.isAdmin, 0))
      .groupBy(users.id)
      .orderBy(desc(users.createdAt));

    return result;
  }

  // Order operations
  async createOrder(order: InsertOrder): Promise<Order> {
    const [newOrder] = await db.insert(orders).values(order).returning();
    return newOrder;
  }

  async createOrderWithSheets(order: InsertOrder, sheets: SheetInfo[]): Promise<Order> {
    // Use a database transaction to ensure atomicity
    // If either order or sheets creation fails, both will be rolled back
    return await db.transaction(async (tx) => {
      // 1. Create the order
      const [newOrder] = await tx.insert(orders).values(order).returning();

      // 2. Create the sheet line items
      if (sheets.length > 0) {
        const sheetValues = sheets.map(sheet => ({
          orderId: newOrder.id,
          sheetElementId: sheet.sheetElementId,
          sheetNumber: sheet.sheetNumber,
          sheetName: sheet.sheetName,
        }));
        await tx.insert(orderSheets).values(sheetValues);
      }

      return newOrder;
    });
  }

  async getOrder(id: string): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    return order;
  }

  async getOrderWithFiles(id: string): Promise<OrderWithFiles | undefined> {
    const order = await this.getOrder(id);
    if (!order) return undefined;

    const orderFiles = await this.getFilesByOrderId(id);
    const sheets = await this.getOrderSheets(id);
    const user = await this.getUser(order.userId);

    return {
      ...order,
      files: orderFiles,
      sheets: sheets,
      user: user ? {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
      } : undefined,
    };
  }

  async getOrdersByUserId(userId: string): Promise<OrderWithFiles[]> {
    const userOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt));

    const ordersWithFiles: OrderWithFiles[] = [];
    for (const order of userOrders) {
      const orderFiles = await this.getFilesByOrderId(order.id);
      const sheets = await this.getOrderSheets(order.id);
      ordersWithFiles.push({
        ...order,
        files: orderFiles,
        sheets: sheets,
      });
    }

    return ordersWithFiles;
  }

  async getAllOrders(): Promise<OrderWithFiles[]> {
    const allOrders = await db
      .select()
      .from(orders)
      .orderBy(desc(orders.createdAt));

    const ordersWithFiles: OrderWithFiles[] = [];
    for (const order of allOrders) {
      const orderFiles = await this.getFilesByOrderId(order.id);
      const sheets = await this.getOrderSheets(order.id);
      const user = await this.getUser(order.userId);
      ordersWithFiles.push({
        ...order,
        files: orderFiles,
        sheets: sheets,
        user: user ? {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
        } : undefined,
      });
    }

    return ordersWithFiles;
  }

  async updateOrder(id: string, data: Partial<Order>): Promise<Order | undefined> {
    const [updated] = await db
      .update(orders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();
    return updated;
  }

  async updateOrderStatus(id: string, status: Order["status"]): Promise<Order | undefined> {
    const now = new Date();
    const updateData: Partial<Order> = { status, updatedAt: now };

    if (status === "paid") {
      updateData.paidAt = now;
    } else if (status === "uploaded") {
      updateData.uploadedAt = now;
    } else if (status === "complete") {
      updateData.completedAt = now;
    }

    const [updated] = await db
      .update(orders)
      .set(updateData)
      .where(eq(orders.id, id))
      .returning();
    return updated;
  }

  // File operations
  async createFile(file: InsertFile): Promise<FileRecord> {
    const [newFile] = await db.insert(files).values(file).returning();
    return newFile;
  }

  async getFile(id: string): Promise<FileRecord | undefined> {
    const [file] = await db.select().from(files).where(eq(files.id, id));
    return file;
  }

  async getFilesByOrderId(orderId: string): Promise<FileRecord[]> {
    return await db.select().from(files).where(eq(files.orderId, orderId));
  }

  // Order sheet operations
  async createOrderSheets(orderId: string, sheets: SheetInfo[]): Promise<OrderSheet[]> {
    if (sheets.length === 0) return [];

    const values = sheets.map(sheet => ({
      orderId,
      sheetElementId: sheet.sheetElementId,
      sheetNumber: sheet.sheetNumber,
      sheetName: sheet.sheetName,
    }));

    const created = await db.insert(orderSheets).values(values).returning();
    return created;
  }

  async getOrderSheets(orderId: string): Promise<OrderSheet[]> {
    return await db.select().from(orderSheets).where(eq(orderSheets.orderId, orderId));
  }

  // API Key operations
  private hashApiKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  private generateApiKey(): string {
    return `lod400_${crypto.randomBytes(32).toString('hex')}`;
  }

  async createApiKey(userId: string, name: string): Promise<{ apiKey: ApiKey; rawKey: string }> {
    const rawKey = this.generateApiKey();
    const keyHash = this.hashApiKey(rawKey);

    const [apiKey] = await db.insert(apiKeys).values({
      userId,
      name,
      keyHash,
    }).returning();

    return { apiKey, rawKey };
  }

  async getApiKeysByUserId(userId: string): Promise<ApiKey[]> {
    return await db.select().from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(desc(apiKeys.createdAt));
  }

  async validateApiKey(rawKey: string): Promise<User | null> {
    const keyHash = this.hashApiKey(rawKey);

    const [result] = await db.select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash));

    if (!result) return null;

    await this.updateApiKeyLastUsed(result.id);

    const user = await this.getUser(result.userId);
    return user || null;
  }

  async deleteApiKey(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .returning();
    return result.length > 0;
  }

  async updateApiKeyLastUsed(id: string): Promise<void> {
    await db.update(apiKeys)
      .set({ lastUsed: new Date() })
      .where(eq(apiKeys.id, id));
  }

  // Password-based auth operations
  async getUserByEmail(email: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || null;
  }

  async createUserWithPassword(
    email: string,
    passwordHash: string,
    firstName?: string,
    lastName?: string
  ): Promise<User> {
    const [user] = await db.insert(users).values({
      email,
      passwordHash,
      firstName: firstName || null,
      lastName: lastName || null,
    }).returning();
    return user;
  }

  async validateUserPassword(email: string, password: string): Promise<User | null> {
    const user = await this.getUserByEmail(email);
    if (!user || !user.passwordHash) {
      return null;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return null;
    }

    return user;
  }

  async setUserPassword(userId: string, passwordHash: string): Promise<User | null> {
    const [updated] = await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated || null;
  }

  async changeUserPassword(
    userId: string,
    currentPassword: string,
    newPasswordHash: string
  ): Promise<{ success: boolean; error?: string }> {
    const user = await this.getUser(userId);
    if (!user) {
      return { success: false, error: "User not found" };
    }

    if (!user.passwordHash) {
      return { success: false, error: "No password set. Use set-password instead." };
    }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      return { success: false, error: "Current password is incorrect" };
    }

    await db
      .update(users)
      .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return { success: true };
  }

  // Add-in session operations
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async createAddinSession(
    userId: string,
    rawToken: string,
    deviceLabel?: string
  ): Promise<{ session: AddinSession; rawToken: string }> {
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const [session] = await db.insert(addinSessions).values({
      userId,
      tokenHash,
      expiresAt,
      deviceLabel: deviceLabel || null,
    }).returning();

    return { session, rawToken };
  }

  async validateAddinSession(rawToken: string): Promise<User | null> {
    const tokenHash = this.hashToken(rawToken);

    const [session] = await db.select()
      .from(addinSessions)
      .where(eq(addinSessions.tokenHash, tokenHash));

    if (!session) return null;

    // Check if session has expired
    if (new Date() > session.expiresAt) {
      // Clean up expired session
      await db.delete(addinSessions).where(eq(addinSessions.id, session.id));
      return null;
    }

    const user = await this.getUser(session.userId);
    return user || null;
  }

  async deleteAddinSession(rawToken: string): Promise<boolean> {
    const tokenHash = this.hashToken(rawToken);

    const result = await db.delete(addinSessions)
      .where(eq(addinSessions.tokenHash, tokenHash))
      .returning();

    return result.length > 0;
  }

  // Password reset token operations
  async createPasswordResetToken(userId: string): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.insert(passwordResetTokens).values({
      userId,
      tokenHash,
      expiresAt,
    });

    return rawToken;
  }

  async validatePasswordResetToken(rawToken: string): Promise<User | null> {
    const tokenHash = this.hashToken(rawToken);

    const [token] = await db.select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash));

    if (!token) return null;

    // Check if token has expired or been used
    if (new Date() > token.expiresAt || token.usedAt) {
      return null;
    }

    const user = await this.getUser(token.userId);
    return user || null;
  }

  async usePasswordResetToken(rawToken: string, newPasswordHash: string): Promise<boolean> {
    const tokenHash = this.hashToken(rawToken);

    const [token] = await db.select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash));

    if (!token || new Date() > token.expiresAt || token.usedAt) {
      return false;
    }

    // Mark token as used and update password
    await db.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, token.id));

    await db.update(users)
      .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
      .where(eq(users.id, token.userId));

    return true;
  }

  // Company operations
  async createCompany(name: string, ownerId: string): Promise<Company> {
    return await db.transaction(async (tx) => {
      // Create company
      const [company] = await tx.insert(companies).values({ name }).returning();

      // Add owner as admin member
      await tx.insert(companyMembers).values({
        companyId: company.id,
        userId: ownerId,
        role: "admin",
      });

      return company;
    });
  }

  async getCompany(companyId: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    return company;
  }

  async getCompanyMembers(companyId: string): Promise<CompanyMember[]> {
    return await db.select()
      .from(companyMembers)
      .where(eq(companyMembers.companyId, companyId))
      .orderBy(desc(companyMembers.createdAt));
  }

  async addCompanyMember(companyId: string, email: string, role: string = "member"): Promise<void> {
    const user = await this.getUserByEmail(email);
    if (!user) {
      throw new Error(`User with email ${email} not found`);
    }

    // Check if already a member
    const [existing] = await db.select()
      .from(companyMembers)
      .where(and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.userId, user.id)
      ));

    if (existing) {
      throw new Error("User is already a member of this company");
    }

    await db.insert(companyMembers).values({
      companyId,
      userId: user.id,
      role,
    });
  }

  async removeCompanyMember(companyId: string, userId: string): Promise<void> {
    await db.delete(companyMembers)
      .where(and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.userId, userId)
      ));
  }

  async updateCompanyBalance(companyId: string, amount: number): Promise<void> {
    await db.update(companies)
      .set({
        balanceSar: sql`${companies.balanceSar} + ${amount}`,
        updatedAt: new Date()
      })
      .where(eq(companies.id, companyId));
  }

  async getPendingRefundRequests(): Promise<any[]> {
    return await db.query.balanceTransactions.findMany({
      where: (t, { and, eq }) => and(eq(t.type, "refund_request"), eq(t.status, "pending")),
      with: {
        user: true,
        order: true,
      },
      orderBy: (t, { desc }) => [desc(t.createdAt)]
    });
  }
}

export const storage = new DatabaseStorage();

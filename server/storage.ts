import {
  users,
  orders,
  files,
  type User,
  type UpsertUser,
  type Order,
  type InsertOrder,
  type File as FileRecord,
  type InsertFile,
  type OrderWithFiles,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getUsersWithOrderStats(): Promise<Array<User & { orderCount: number; totalSpent: number }>>;
  
  // Order operations
  createOrder(order: InsertOrder): Promise<Order>;
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

  async getOrder(id: string): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    return order;
  }

  async getOrderWithFiles(id: string): Promise<OrderWithFiles | undefined> {
    const order = await this.getOrder(id);
    if (!order) return undefined;

    const orderFiles = await this.getFilesByOrderId(id);
    const user = await this.getUser(order.userId);

    return {
      ...order,
      files: orderFiles,
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
      ordersWithFiles.push({
        ...order,
        files: orderFiles,
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
      const user = await this.getUser(order.userId);
      ordersWithFiles.push({
        ...order,
        files: orderFiles,
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
}

export const storage = new DatabaseStorage();

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isAdmin } from "./replitAuth";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { createOrderRequestSchema, PRICE_PER_SHEET_SAR } from "@shared/schema";
import { getUncachableStripeClient } from "./stripeClient";

const objectStorage = new ObjectStorageService();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);

  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // ============================================
  // CLIENT API ROUTES
  // ============================================

  app.get("/api/orders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const orders = await storage.getOrdersByUserId(userId);
      res.json(orders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.post("/api/orders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const parsed = createOrderRequestSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { sheetCount } = parsed.data;
      const totalPriceSar = sheetCount * PRICE_PER_SHEET_SAR;

      const order = await storage.createOrder({
        userId,
        sheetCount,
        totalPriceSar,
        status: "pending",
      });

      res.status(201).json(order);
    } catch (error) {
      console.error("Error creating order:", error);
      res.status(500).json({ message: "Failed to create order" });
    }
  });

  app.get("/api/orders/:orderId/checkout", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orderId } = req.params;

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (order.status !== "pending") {
        return res.status(400).json({ message: "Order is not pending payment" });
      }

      const stripe = await getUncachableStripeClient();

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "sar",
              product_data: {
                name: `LOD 400 Sheet Upgrade (${order.sheetCount} sheets)`,
                description: `Professional LOD 300 to LOD 400 model upgrade for ${order.sheetCount} sheets`,
              },
              unit_amount: order.totalPriceSar * 100,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${req.protocol}://${req.get('host')}/?payment=success&order=${orderId}`,
        cancel_url: `${req.protocol}://${req.get('host')}/?payment=cancelled&order=${orderId}`,
        metadata: {
          orderId,
          userId,
        },
      });

      await storage.updateOrder(orderId, { stripeSessionId: session.id });

      res.redirect(session.url!);
    } catch (error) {
      console.error("Error creating checkout:", error);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  app.post("/api/orders/:orderId/upload-url", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orderId } = req.params;
      const { fileName } = req.body;

      if (!fileName) {
        return res.status(400).json({ message: "fileName is required" });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (order.status !== "paid") {
        return res.status(400).json({ message: "Order must be paid before uploading files" });
      }

      const uploadURL = await objectStorage.getUploadURL(orderId, fileName);
      
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ message: "Failed to get upload URL" });
    }
  });

  app.post("/api/orders/:orderId/upload-complete", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orderId } = req.params;
      const { fileName, fileSize, uploadURL } = req.body;

      if (!fileName || !uploadURL) {
        return res.status(400).json({ message: "fileName and uploadURL are required" });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const storageKey = objectStorage.normalizeStorageKey(uploadURL);

      await storage.createFile({
        orderId,
        fileType: "input",
        fileName,
        fileSize: fileSize || null,
        storageKey,
        mimeType: "application/zip",
      });

      await storage.updateOrderStatus(orderId, "uploaded");

      res.json({ success: true });
    } catch (error) {
      console.error("Error completing upload:", error);
      res.status(500).json({ message: "Failed to complete upload" });
    }
  });

  app.get("/api/orders/:orderId/status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orderId } = req.params;

      const order = await storage.getOrderWithFiles(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const user = await storage.getUser(userId);
      if (order.userId !== userId && !user?.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }

      res.json(order);
    } catch (error) {
      console.error("Error checking order status:", error);
      res.status(500).json({ message: "Failed to check order status" });
    }
  });

  app.get("/api/files/:fileId/download", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { fileId } = req.params;

      const file = await storage.getFile(fileId);
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      const order = await storage.getOrder(file.orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const user = await storage.getUser(userId);
      if (order.userId !== userId && !user?.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const downloadURL = await objectStorage.getDownloadURL(file.storageKey);
      res.redirect(downloadURL);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ message: "File not found in storage" });
      }
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  // ============================================
  // ADMIN API ROUTES
  // ============================================

  app.get("/api/admin/orders", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const orders = await storage.getAllOrders();
      res.json(orders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.get("/api/admin/clients", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const clients = await storage.getUsersWithOrderStats();
      res.json(clients);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.patch("/api/admin/orders/:orderId/status", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { orderId } = req.params;
      const { status } = req.body;

      if (!["pending", "paid", "uploaded", "processing", "complete"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const order = await storage.updateOrderStatus(orderId, status);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      res.json(order);
    } catch (error) {
      console.error("Error updating order status:", error);
      res.status(500).json({ message: "Failed to update order status" });
    }
  });

  app.post("/api/admin/orders/:orderId/upload-url", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { orderId } = req.params;
      const { fileName } = req.body;

      if (!fileName) {
        return res.status(400).json({ message: "fileName is required" });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.status !== "uploaded" && order.status !== "processing") {
        return res.status(400).json({ message: "Order is not ready for deliverables" });
      }

      const uploadURL = await objectStorage.getUploadURL(orderId, fileName);
      
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ message: "Failed to get upload URL" });
    }
  });

  app.post("/api/admin/orders/:orderId/upload-complete", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { orderId } = req.params;
      const { fileName, fileSize, uploadURL } = req.body;

      if (!fileName || !uploadURL) {
        return res.status(400).json({ message: "fileName and uploadURL are required" });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const storageKey = objectStorage.normalizeStorageKey(uploadURL);

      await storage.createFile({
        orderId,
        fileType: "output",
        fileName,
        fileSize: fileSize || null,
        storageKey,
        mimeType: "application/zip",
      });

      await storage.updateOrderStatus(orderId, "processing");

      res.json({ success: true });
    } catch (error) {
      console.error("Error completing upload:", error);
      res.status(500).json({ message: "Failed to complete upload" });
    }
  });

  app.post("/api/admin/orders/:orderId/complete", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { orderId } = req.params;

      const order = await storage.getOrderWithFiles(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const hasOutputFiles = order.files?.some(f => f.fileType === "output");
      if (!hasOutputFiles) {
        return res.status(400).json({ message: "Must upload deliverables before completing" });
      }

      await storage.updateOrderStatus(orderId, "complete");

      console.log(`Order ${orderId} marked complete. Client email: ${order.user?.email}`);

      res.json({ success: true });
    } catch (error) {
      console.error("Error completing order:", error);
      res.status(500).json({ message: "Failed to complete order" });
    }
  });

  // ============================================
  // API KEY MANAGEMENT (for Revit add-in users)
  // ============================================

  app.get("/api/user/api-keys", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const keys = await storage.getApiKeysByUserId(userId);
      const safeKeys = keys.map(k => ({
        id: k.id,
        name: k.name,
        lastUsed: k.lastUsed,
        createdAt: k.createdAt,
      }));
      res.json(safeKeys);
    } catch (error) {
      console.error("Error fetching API keys:", error);
      res.status(500).json({ message: "Failed to fetch API keys" });
    }
  });

  app.post("/api/user/api-keys", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { name } = req.body;
      
      if (!name || typeof name !== "string") {
        return res.status(400).json({ message: "Name is required" });
      }

      const { apiKey, rawKey } = await storage.createApiKey(userId, name);
      res.status(201).json({
        id: apiKey.id,
        name: apiKey.name,
        key: rawKey,
        createdAt: apiKey.createdAt,
      });
    } catch (error) {
      console.error("Error creating API key:", error);
      res.status(500).json({ message: "Failed to create API key" });
    }
  });

  app.delete("/api/user/api-keys/:keyId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { keyId } = req.params;
      
      const deleted = await storage.deleteApiKey(keyId, userId);
      if (!deleted) {
        return res.status(404).json({ message: "API key not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting API key:", error);
      res.status(500).json({ message: "Failed to delete API key" });
    }
  });

  // ============================================
  // API ROUTES FOR REVIT ADD-IN (API Key Auth)
  // ============================================

  const isApiKeyAuthenticated = async (req: any, res: any, next: any) => {
    const apiKey = req.headers["x-api-key"];
    
    if (!apiKey || typeof apiKey !== "string") {
      return res.status(401).json({ message: "API key required" });
    }

    const user = await storage.validateApiKey(apiKey);
    if (!user) {
      return res.status(401).json({ message: "Invalid API key" });
    }

    req.apiUser = user;
    next();
  };

  app.get("/api/addin/validate", isApiKeyAuthenticated, async (req: any, res) => {
    res.json({ valid: true, userId: req.apiUser.id });
  });

  app.post("/api/addin/create-order", isApiKeyAuthenticated, async (req: any, res) => {
    try {
      const userId = req.apiUser.id;
      const parsed = createOrderRequestSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { sheetCount } = parsed.data;
      const totalPriceSar = sheetCount * PRICE_PER_SHEET_SAR;

      const order = await storage.createOrder({
        userId,
        sheetCount,
        totalPriceSar,
        status: "pending",
      });

      const stripe = await getUncachableStripeClient();

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "sar",
              product_data: {
                name: `LOD 400 Sheet Upgrade (${order.sheetCount} sheets)`,
                description: `Professional LOD 300 to LOD 400 model upgrade for ${order.sheetCount} sheets`,
              },
              unit_amount: order.totalPriceSar * 100,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}/?payment=success&order=${order.id}`,
        cancel_url: `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}/?payment=cancelled&order=${order.id}`,
        metadata: {
          orderId: order.id,
          userId,
        },
      });

      await storage.updateOrder(order.id, { stripeSessionId: session.id });

      res.status(201).json({ 
        order,
        checkoutUrl: session.url 
      });
    } catch (error) {
      console.error("Error creating order:", error);
      res.status(500).json({ message: "Failed to create order" });
    }
  });

  app.get("/api/addin/orders", isApiKeyAuthenticated, async (req: any, res) => {
    try {
      const userId = req.apiUser.id;
      const orders = await storage.getOrdersByUserId(userId);
      res.json(orders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.get("/api/addin/orders/:orderId/status", isApiKeyAuthenticated, async (req: any, res) => {
    try {
      const userId = req.apiUser.id;
      const { orderId } = req.params;

      const order = await storage.getOrderWithFiles(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      res.json(order);
    } catch (error) {
      console.error("Error checking order status:", error);
      res.status(500).json({ message: "Failed to check order status" });
    }
  });

  app.post("/api/addin/orders/:orderId/upload-url", isApiKeyAuthenticated, async (req: any, res) => {
    try {
      const userId = req.apiUser.id;
      const { orderId } = req.params;
      const { fileName } = req.body;

      if (!fileName) {
        return res.status(400).json({ message: "fileName is required" });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (order.status !== "paid") {
        return res.status(400).json({ message: "Order must be paid before uploading files" });
      }

      const uploadURL = await objectStorage.getUploadURL(orderId, fileName);
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ message: "Failed to get upload URL" });
    }
  });

  app.post("/api/addin/orders/:orderId/upload-complete", isApiKeyAuthenticated, async (req: any, res) => {
    try {
      const userId = req.apiUser.id;
      const { orderId } = req.params;
      const { fileName, fileSize, uploadURL } = req.body;

      if (!fileName || !uploadURL) {
        return res.status(400).json({ message: "fileName and uploadURL are required" });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const storageKey = objectStorage.normalizeStorageKey(uploadURL);

      await storage.createFile({
        orderId,
        fileType: "input",
        fileName,
        fileSize: fileSize || null,
        storageKey,
        mimeType: "application/zip",
      });

      await storage.updateOrderStatus(orderId, "uploaded");
      res.json({ success: true });
    } catch (error) {
      console.error("Error completing upload:", error);
      res.status(500).json({ message: "Failed to complete upload" });
    }
  });

  app.get("/api/addin/orders/:orderId/download-url", isApiKeyAuthenticated, async (req: any, res) => {
    try {
      const userId = req.apiUser.id;
      const { orderId } = req.params;

      const order = await storage.getOrderWithFiles(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (order.status !== "complete") {
        return res.status(400).json({ message: "Order is not complete" });
      }

      const outputFile = order.files?.find(f => f.fileType === "output");
      if (!outputFile) {
        return res.status(404).json({ message: "No deliverables found" });
      }

      const downloadURL = await objectStorage.getDownloadURL(outputFile.storageKey);
      res.json({ downloadURL, fileName: outputFile.fileName });
    } catch (error) {
      console.error("Error getting download URL:", error);
      res.status(500).json({ message: "Failed to get download URL" });
    }
  });

  app.get("/api/orders/:orderId/download-url", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orderId } = req.params;

      const order = await storage.getOrderWithFiles(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (order.status !== "complete") {
        return res.status(400).json({ message: "Order is not complete" });
      }

      const outputFile = order.files?.find(f => f.fileType === "output");
      if (!outputFile) {
        return res.status(404).json({ message: "No deliverables found" });
      }

      const downloadURL = await objectStorage.getDownloadURL(outputFile.storageKey);
      res.json({ downloadURL, fileName: outputFile.fileName });
    } catch (error) {
      console.error("Error getting download URL:", error);
      res.status(500).json({ message: "Failed to get download URL" });
    }
  });

  // Get Stripe publishable key for frontend
  app.get("/api/stripe/config", async (req, res) => {
    try {
      const { getStripePublishableKey } = await import("./stripeClient");
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (error) {
      console.error("Error getting Stripe config:", error);
      res.status(500).json({ message: "Failed to get Stripe configuration" });
    }
  });

  return httpServer;
}

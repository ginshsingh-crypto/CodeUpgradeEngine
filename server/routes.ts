import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isAdmin } from "./replitAuth";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { createOrderRequestSchema, PRICE_PER_SHEET_SAR } from "@shared/schema";
import Stripe from "stripe";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const objectStorage = new ObjectStorageService();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
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

  // Get user's orders
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

  // Create a new order
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

  // Get checkout URL for an order
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

      if (!stripe) {
        return res.status(500).json({ message: "Payment system not configured" });
      }

      // Create Stripe checkout session
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
              unit_amount: order.totalPriceSar * 100, // Stripe expects cents/halalas
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${req.protocol}://${req.hostname}/?payment=success&order=${orderId}`,
        cancel_url: `${req.protocol}://${req.hostname}/?payment=cancelled&order=${orderId}`,
        metadata: {
          orderId,
          userId,
        },
      });

      // Update order with session ID
      await storage.updateOrder(orderId, { stripeSessionId: session.id });

      res.redirect(session.url!);
    } catch (error) {
      console.error("Error creating checkout:", error);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  // Get upload URL for order files
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

  // Mark upload complete
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

      // Normalize storage key from upload URL
      const storageKey = objectStorage.normalizeStorageKey(uploadURL);

      // Create file record
      await storage.createFile({
        orderId,
        fileType: "input",
        fileName,
        fileSize: fileSize || null,
        storageKey,
        mimeType: "application/zip",
      });

      // Update order status
      await storage.updateOrderStatus(orderId, "uploaded");

      res.json({ success: true });
    } catch (error) {
      console.error("Error completing upload:", error);
      res.status(500).json({ message: "Failed to complete upload" });
    }
  });

  // Check order status
  app.get("/api/orders/:orderId/status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { orderId } = req.params;

      const order = await storage.getOrderWithFiles(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Allow both owner and admin to check status
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

  // Download file
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

      // Allow both owner and admin to download
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

  // Get all orders (admin)
  app.get("/api/admin/orders", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const orders = await storage.getAllOrders();
      res.json(orders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  // Get all clients (admin)
  app.get("/api/admin/clients", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const clients = await storage.getUsersWithOrderStats();
      res.json(clients);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  // Update order status (admin)
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

  // Upload deliverables URL (admin)
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

  // Admin upload complete
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

  // Mark order complete (admin)
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

      // TODO: Send email notification to client via Resend
      // For now, just log it
      console.log(`Order ${orderId} marked complete. Client email: ${order.user?.email}`);

      res.json({ success: true });
    } catch (error) {
      console.error("Error completing order:", error);
      res.status(500).json({ message: "Failed to complete order" });
    }
  });

  // ============================================
  // STRIPE WEBHOOK
  // ============================================

  app.post("/api/webhooks/stripe", async (req, res) => {
    if (!stripe) {
      return res.status(500).json({ message: "Stripe not configured" });
    }

    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !endpointSecret) {
      return res.status(400).json({ message: "Missing signature or secret" });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody as Buffer,
        sig,
        endpointSecret
      );
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).json({ message: `Webhook Error: ${err.message}` });
    }

    // Handle the event
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;

        if (orderId) {
          await storage.updateOrder(orderId, {
            stripePaymentIntentId: session.payment_intent as string,
          });
          await storage.updateOrderStatus(orderId, "paid");
          console.log(`Order ${orderId} payment completed`);
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;
        console.log(`Checkout session expired for order ${orderId}`);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  });

  // ============================================
  // API ROUTES FOR REVIT ADD-IN
  // ============================================

  // Create order from add-in (returns checkout URL)
  app.post("/api/addin/create-order", isAuthenticated, async (req: any, res) => {
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

      if (!stripe) {
        return res.status(201).json({ 
          order,
          checkoutUrl: null,
          message: "Payment system not configured" 
        });
      }

      // Create Stripe checkout session
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
        success_url: `${req.protocol}://${req.hostname}/?payment=success&order=${order.id}`,
        cancel_url: `${req.protocol}://${req.hostname}/?payment=cancelled&order=${order.id}`,
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

  // Get download URL for completed order (add-in)
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

  return httpServer;
}

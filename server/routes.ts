import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isAdmin } from "./replitAuth";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { createOrderRequestSchema, PRICE_PER_SHEET_SAR } from "@shared/schema";
import { getUncachableStripeClient } from "./stripeClient";
import { sendPasswordResetEmail, sendOrderPaidEmail, sendOrderCompleteEmail } from "./emailService";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";

const objectStorage = new ObjectStorageService();

// ============================================
// RATE LIMITING FOR AUTH ENDPOINTS
// ============================================
const authAttempts = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(key: string, maxAttempts = 5, windowMs = 60000): boolean {
  const now = Date.now();
  const record = authAttempts.get(key);
  
  if (!record || now > record.resetTime) {
    authAttempts.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  if (record.count >= maxAttempts) {
    return false;
  }
  
  record.count++;
  return true;
}

function checkLoginRateLimit(ip: string, email: string): boolean {
  const rateLimitKey = `login:${ip}-${email.toLowerCase()}`;
  return checkRateLimit(rateLimitKey, 10, 60000);
}

function checkRegistrationRateLimit(ip: string): boolean {
  const rateLimitKey = `register:${ip}`;
  return checkRateLimit(rateLimitKey, 5, 60000);
}

function checkPasswordEndpointRateLimit(ip: string, userId?: string): boolean {
  const rateLimitKey = userId ? `password:${ip}-${userId}` : `password:${ip}`;
  return checkRateLimit(rateLimitKey, 20, 60000);
}

// Periodic cleanup of expired rate limit entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  authAttempts.forEach((record, key) => {
    if (now > record.resetTime) {
      authAttempts.delete(key);
    }
  });
}, 5 * 60 * 1000);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);

  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const user = req.dbUser;
      if (user) {
        const { passwordHash, passwordSalt, ...safeUser } = user;
        res.json({
          ...safeUser,
          hasPassword: !!passwordHash,
        });
      } else {
        res.status(404).json({ message: "User not found" });
      }
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // ============================================
  // PASSWORD-BASED AUTH FOR REVIT ADD-IN
  // ============================================

  const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  });

  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
    deviceLabel: z.string().optional(),
  });

  // Helper to extract Bearer token from Authorization header
  const extractBearerToken = (authHeader: string | undefined): string | null => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }
    return authHeader.slice(7);
  };

  // Helper to return safe user info (no password)
  const safeUserInfo = (user: any) => ({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImageUrl: user.profileImageUrl,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt,
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      // Rate limiting: max 5 attempts per IP per minute (IP-only for registration)
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRegistrationRateLimit(ip)) {
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }

      const parsed = registerSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { email, password, firstName, lastName } = parsed.data;

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ message: "User with this email already exists" });
      }

      // Hash password with bcrypt (cost 12)
      const passwordHash = await bcrypt.hash(password, 12);

      // Create user
      const user = await storage.createUserWithPassword(email, passwordHash, firstName, lastName);

      // Auto-login: set web session cookie
      req.session.userId = user.id;

      res.status(201).json({
        message: "User registered successfully",
        user: safeUserInfo(user),
      });
    } catch (error) {
      console.error("Error registering user:", error);
      res.status(500).json({ message: "Failed to register user" });
    }
  });

  // Web login (sets cookie session)
  app.post("/api/auth/web-login", async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { email, password } = parsed.data;

      // Rate limiting: max 10 attempts per IP+email per minute
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkLoginRateLimit(ip, email)) {
        return res.status(429).json({ message: "Too many login attempts. Please try again later." });
      }

      // Validate credentials
      const user = await storage.validateUserPassword(email, password);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Set web session cookie
      req.session.userId = user.id;

      res.json({
        message: "Login successful",
        user: safeUserInfo(user),
      });
    } catch (error) {
      console.error("Error logging in:", error);
      res.status(500).json({ message: "Failed to login" });
    }
  });

  // Add-in login (returns Bearer token)
  app.post("/api/auth/login", async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { email, password, deviceLabel } = parsed.data;

      // Rate limiting: max 10 attempts per IP+email per minute
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkLoginRateLimit(ip, email)) {
        return res.status(429).json({ message: "Too many login attempts. Please try again later." });
      }

      // Validate credentials
      const user = await storage.validateUserPassword(email, password);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Generate secure token for add-in
      const rawToken = crypto.randomBytes(32).toString("hex");

      // Create add-in session
      const { session } = await storage.createAddinSession(user.id, rawToken, deviceLabel);

      res.json({
        message: "Login successful",
        token: rawToken,
        expiresAt: session.expiresAt,
        user: safeUserInfo(user),
      });
    } catch (error) {
      console.error("Error logging in:", error);
      res.status(500).json({ message: "Failed to login" });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const token = extractBearerToken(req.headers.authorization);
      
      if (!token) {
        return res.status(401).json({ message: "Authorization token required" });
      }

      const deleted = await storage.deleteAddinSession(token);
      
      if (!deleted) {
        return res.status(401).json({ message: "Invalid or expired session" });
      }

      res.json({ message: "Logged out successfully" });
    } catch (error) {
      console.error("Error logging out:", error);
      res.status(500).json({ message: "Failed to logout" });
    }
  });

  app.get("/api/auth/validate", async (req, res) => {
    try {
      const token = extractBearerToken(req.headers.authorization);
      
      if (!token) {
        return res.status(401).json({ message: "Authorization token required" });
      }

      const user = await storage.validateAddinSession(token);
      
      if (!user) {
        return res.status(401).json({ message: "Invalid or expired session" });
      }

      res.json({
        valid: true,
        user: safeUserInfo(user),
      });
    } catch (error) {
      console.error("Error validating session:", error);
      res.status(500).json({ message: "Failed to validate session" });
    }
  });

  // ============================================
  // PASSWORD MANAGEMENT FOR WEB USERS
  // ============================================

  const setPasswordSchema = z.object({
    password: z.string().min(8, "Password must be at least 8 characters"),
  });

  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
  });

  app.post("/api/auth/set-password", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      // Rate limiting: max 20 attempts per IP+user per minute for password endpoints
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkPasswordEndpointRateLimit(ip, userId)) {
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }

      const parsed = setPasswordSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.passwordHash) {
        return res.status(400).json({ message: "Password already set. Use change-password instead." });
      }

      const { password } = parsed.data;
      const passwordHash = await bcrypt.hash(password, 12);

      const updatedUser = await storage.setUserPassword(userId, passwordHash);
      if (!updatedUser) {
        return res.status(500).json({ message: "Failed to set password" });
      }

      res.json({ message: "Password set successfully" });
    } catch (error) {
      console.error("Error setting password:", error);
      res.status(500).json({ message: "Failed to set password" });
    }
  });

  app.post("/api/auth/change-password", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      // Rate limiting: max 20 attempts per IP+user per minute for password endpoints
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkPasswordEndpointRateLimit(ip, userId)) {
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }

      const parsed = changePasswordSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { currentPassword, newPassword } = parsed.data;
      const newPasswordHash = await bcrypt.hash(newPassword, 12);

      const result = await storage.changeUserPassword(userId, currentPassword, newPasswordHash);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // ============================================
  // PASSWORD RESET
  // ============================================

  const forgotPasswordSchema = z.object({
    email: z.string().email(),
  });

  const resetPasswordSchema = z.object({
    token: z.string(),
    password: z.string().min(8),
  });

  const validateResetTokenSchema = z.object({
    token: z.string(),
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(`forgot:${ip}`, 5, 60000)) {
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }

      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      const { email } = parsed.data;
      const user = await storage.getUserByEmail(email);

      // Always return success to prevent email enumeration
      if (!user) {
        console.log(`Password reset requested for non-existent email: ${email}`);
        return res.json({ message: "If an account exists, a reset link has been sent." });
      }

      const token = await storage.createPasswordResetToken(user.id);
      
      // Use HTTPS for production, handle reverse proxy
      const host = req.get('host');
      const protocol = host?.includes('replit') || host?.includes('deepnewbim') ? 'https' : req.protocol;
      const resetUrl = `${protocol}://${host}/reset-password?token=${token}`;

      // Send password reset email
      const emailSent = await sendPasswordResetEmail(email, resetUrl, user.firstName || undefined);
      
      if (emailSent) {
        console.log(`Password reset email sent to ${email}`);
      } else {
        // Fallback: log the reset URL
        console.log(`PASSWORD RESET LINK for ${email}: ${resetUrl}`);
      }

      res.json({ message: "If an account exists, a reset link has been sent." });
    } catch (error) {
      console.error("Error processing forgot password:", error);
      res.status(500).json({ message: "Failed to process request" });
    }
  });

  app.post("/api/auth/validate-reset-token", async (req, res) => {
    try {
      const parsed = validateResetTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid token" });
      }

      const { token } = parsed.data;
      const user = await storage.validatePasswordResetToken(token);

      if (!user) {
        return res.status(400).json({ message: "Invalid or expired token" });
      }

      res.json({ valid: true });
    } catch (error) {
      console.error("Error validating reset token:", error);
      res.status(500).json({ message: "Failed to validate token" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { token, password } = parsed.data;
      const passwordHash = await bcrypt.hash(password, 12);
      
      const success = await storage.usePasswordResetToken(token, passwordHash);

      if (!success) {
        return res.status(400).json({ message: "Invalid or expired token" });
      }

      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // ============================================
  // CLIENT API ROUTES
  // ============================================

  app.get("/api/orders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const orders = await storage.getOrdersByUserId(userId);
      res.json(orders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.post("/api/orders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
      const parsed = createOrderRequestSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { sheetCount, sheets } = parsed.data;

      // Security validation: sheet count must match actual sheets array
      // Prevents pricing exploit where client sends low sheetCount with many sheets
      if (sheets && sheets.length > 0 && sheets.length !== sheetCount) {
        return res.status(400).json({ 
          message: `Sheet count mismatch: claimed ${sheetCount} but provided ${sheets.length} sheets` 
        });
      }

      const totalPriceSar = sheetCount * PRICE_PER_SHEET_SAR;

      const order = await storage.createOrder({
        userId,
        sheetCount,
        totalPriceSar,
        status: "pending",
      });

      // Store individual sheet details for dispute resolution
      if (sheets && sheets.length > 0) {
        await storage.createOrderSheets(order.id, sheets);
      }

      res.status(201).json(order);
    } catch (error) {
      console.error("Error creating order:", error);
      res.status(500).json({ message: "Failed to create order" });
    }
  });

  app.get("/api/orders/:orderId/checkout", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.dbUser.id;
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

      // TEST MODE: Skip Stripe and mark order as paid immediately
      if (process.env.TEST_MODE === "true") {
        await storage.updateOrder(orderId, { status: "paid" });
        
        // Send payment confirmation email in TEST_MODE too
        const user = await storage.getUser(userId);
        if (user?.email) {
          sendOrderPaidEmail(
            user.email,
            orderId,
            order.sheetCount,
            user.firstName || undefined
          ).catch(err => console.error('Failed to send paid email:', err));
        }
        
        return res.redirect(`/?payment=success&order=${orderId}&test_mode=true`);
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
      const userId = req.dbUser.id;
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
      const userId = req.dbUser.id;
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

      // Security check: Verify file actually exists in GCS before recording
      // Prevents "fake upload" attacks where client claims upload without data
      const verification = await objectStorage.verifyFileExists(storageKey);
      if (!verification.exists) {
        console.warn(`Upload verification failed for order ${orderId}: file not found at ${storageKey}`);
        return res.status(400).json({ 
          message: "Upload verification failed: file not found in storage. Please try uploading again." 
        });
      }

      // Use verified size if client didn't provide one
      const verifiedSize = verification.size || fileSize || null;

      await storage.createFile({
        orderId,
        fileType: "input",
        fileName,
        fileSize: verifiedSize,
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
      const userId = req.dbUser.id;
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
      const userId = req.dbUser.id;
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

      // Security check: Verify file actually exists in GCS before recording
      const verification = await objectStorage.verifyFileExists(storageKey);
      if (!verification.exists) {
        console.warn(`Admin upload verification failed for order ${orderId}: file not found at ${storageKey}`);
        return res.status(400).json({ 
          message: "Upload verification failed: file not found in storage. Please try uploading again." 
        });
      }

      // Use verified size if not provided
      const verifiedSize = verification.size || fileSize || null;

      await storage.createFile({
        orderId,
        fileType: "output",
        fileName,
        fileSize: verifiedSize,
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

      // Send order complete notification email
      if (order.user?.email) {
        sendOrderCompleteEmail(
          order.user.email,
          orderId,
          order.sheetCount,
          order.user.firstName || undefined
        ).catch(err => console.error('Failed to send complete email:', err));
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error completing order:", error);
      res.status(500).json({ message: "Failed to complete order" });
    }
  });

  // ============================================
  // API ROUTES FOR REVIT ADD-IN (Bearer Token Auth)
  // ============================================

  const isAddinAuthenticated = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const user = await storage.validateAddinSession(token);
      if (user) {
        req.apiUser = user;
        return next();
      }
    }

    return res.status(401).json({ message: "Authentication required. Please sign in with your email and password." });
  };

  app.get("/api/addin/validate", isAddinAuthenticated, async (req: any, res) => {
    res.json({ valid: true, userId: req.apiUser.id });
  });

  app.post("/api/addin/create-order", isAddinAuthenticated, async (req: any, res) => {
    try {
      const userId = req.apiUser.id;
      const parsed = createOrderRequestSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { sheetCount, sheets } = parsed.data;

      // Security validation: sheet count must match actual sheets array
      // Prevents pricing exploit where client sends low sheetCount with many sheets
      if (sheets && sheets.length > 0 && sheets.length !== sheetCount) {
        return res.status(400).json({ 
          message: `Sheet count mismatch: claimed ${sheetCount} but provided ${sheets.length} sheets` 
        });
      }

      const totalPriceSar = sheetCount * PRICE_PER_SHEET_SAR;

      const order = await storage.createOrder({
        userId,
        sheetCount,
        totalPriceSar,
        status: "pending",
      });

      // Store individual sheet details for dispute resolution
      if (sheets && sheets.length > 0) {
        await storage.createOrderSheets(order.id, sheets);
      }

      // TEST MODE: Skip Stripe and mark order as paid immediately
      if (process.env.TEST_MODE === "true") {
        await storage.updateOrder(order.id, { status: "paid" });
        
        // Send payment confirmation email in TEST_MODE too
        const user = await storage.getUser(userId);
        if (user?.email) {
          sendOrderPaidEmail(
            user.email,
            order.id,
            order.sheetCount,
            user.firstName || undefined
          ).catch(err => console.error('Failed to send paid email:', err));
        }
        
        return res.status(201).json({ 
          order: { ...order, status: "paid" },
          checkoutUrl: null,
          testMode: true
        });
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

  app.get("/api/addin/orders", isAddinAuthenticated, async (req: any, res) => {
    try {
      const userId = req.apiUser.id;
      const orders = await storage.getOrdersByUserId(userId);
      res.json(orders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.get("/api/addin/orders/:orderId/status", isAddinAuthenticated, async (req: any, res) => {
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

  app.post("/api/addin/orders/:orderId/upload-url", isAddinAuthenticated, async (req: any, res) => {
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

  // Resumable upload endpoints for large files
  app.post("/api/addin/orders/:orderId/resumable-upload", isAddinAuthenticated, async (req: any, res) => {
    try {
      const userId = req.apiUser.id;
      const { orderId } = req.params;
      const { fileName, fileSize } = req.body;

      if (!fileName || !fileSize) {
        return res.status(400).json({ message: "fileName and fileSize are required" });
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

      const { sessionUri, storageKey } = await objectStorage.initiateResumableUpload(orderId, fileName, fileSize);
      res.json({ sessionUri, storageKey });
    } catch (error) {
      console.error("Error initiating resumable upload:", error);
      res.status(500).json({ message: "Failed to initiate resumable upload" });
    }
  });

  app.post("/api/addin/resumable-upload-status", isAddinAuthenticated, async (req: any, res) => {
    try {
      const { sessionUri } = req.body;

      if (!sessionUri) {
        return res.status(400).json({ message: "sessionUri is required" });
      }

      const { bytesUploaded, isComplete } = await objectStorage.checkResumableUploadStatus(sessionUri);
      res.json({ bytesUploaded, isComplete });
    } catch (error) {
      console.error("Error checking resumable upload status:", error);
      res.status(500).json({ message: "Failed to check upload status" });
    }
  });

  app.post("/api/addin/orders/:orderId/upload-complete", isAddinAuthenticated, async (req: any, res) => {
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

      // Security check: Verify file actually exists in GCS before recording
      // Prevents "fake upload" attacks where client claims upload without data
      const verification = await objectStorage.verifyFileExists(storageKey);
      if (!verification.exists) {
        console.warn(`Upload verification failed for order ${orderId}: file not found at ${storageKey}`);
        return res.status(400).json({ 
          message: "Upload verification failed: file not found in storage. Please try uploading again." 
        });
      }

      // Use verified size if client didn't provide one
      const verifiedSize = verification.size || fileSize || null;

      await storage.createFile({
        orderId,
        fileType: "input",
        fileName,
        fileSize: verifiedSize,
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

  app.get("/api/addin/orders/:orderId/download-url", isAddinAuthenticated, async (req: any, res) => {
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
      const userId = req.dbUser.id;
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

  // ============================================
  // DOWNLOAD ROUTES (for Revit add-in distribution)
  // ============================================

  const fs = await import("fs");
  const path = await import("path");
  const archiver = await import("archiver");

  app.get("/api/downloads/installer.ps1", (req, res) => {
    const installerPath = path.default.join(process.cwd(), "revit-addin", "Install-LOD400.ps1");
    
    if (!fs.default.existsSync(installerPath)) {
      return res.status(404).send("Installer not found");
    }
    
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", "attachment; filename=Install-LOD400.ps1");
    res.sendFile(installerPath);
  });

  app.get("/api/downloads/addin-source.zip", (req, res) => {
    const addinDir = path.default.join(process.cwd(), "revit-addin");
    
    if (!fs.default.existsSync(addinDir)) {
      return res.status(404).send("Add-in source not found");
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=LOD400-Addin-Source.zip");

    const archive = archiver.default("zip", { zlib: { level: 9 } });
    archive.on("error", (err: Error) => {
      res.status(500).send("Error creating archive");
    });

    archive.pipe(res);
    archive.directory(addinDir, "LOD400-Addin");
    archive.finalize();
  });

  app.get("/api/downloads/addin-compiled.zip", async (req, res) => {
    const addinDir = path.default.join(process.cwd(), "revit-addin");
    
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=LOD400-Addin.zip");

    const archive = archiver.default("zip", { zlib: { level: 9 } });
    archive.on("error", (err: Error) => {
      res.status(500).send("Error creating archive");
    });

    archive.pipe(res);
    
    archive.file(path.default.join(addinDir, "Install-LOD400.ps1"), { name: "Install-LOD400.ps1" });
    archive.file(path.default.join(addinDir, "LOD400Uploader", "LOD400Uploader.addin"), { name: "LOD400Uploader.addin" });
    archive.file(path.default.join(addinDir, "README.md"), { name: "README.md" });
    
    const readmeContent = `LOD 400 Uploader - Revit Add-in
================================

INSTALLATION:
1. Right-click "Install-LOD400.ps1" and select "Run with PowerShell"
2. Follow the prompts to install
3. Restart Revit

NOTE: This package contains source code that needs to be compiled.
To compile:
1. Open LOD400Uploader/LOD400Uploader.csproj in Visual Studio 2022
2. Update Revit API references to match your Revit version
3. Build in Release mode
4. Run the installer

For pre-compiled versions, contact support.
`;
    archive.append(readmeContent, { name: "INSTALL.txt" });
    
    archive.directory(path.default.join(addinDir, "LOD400Uploader"), "LOD400Uploader");
    archive.finalize();
  });

  return httpServer;
}

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isAdmin } from "./replitAuth";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { createOrderRequestSchema, PRICE_PER_SHEET_SAR } from "@shared/schema";
import { getUncachableStripeClient } from "./stripeClient";
import { sendPasswordResetEmail, sendOrderPaidEmail, sendOrderCompleteEmail, sendContactFormEmail } from "./emailService";
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

  // ============================================
  // PUBLIC CONTACT FORM (NO AUTH REQUIRED)
  // ============================================
  const contactFormSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    email: z.string().email("Invalid email address"),
    message: z.string().min(10, "Message must be at least 10 characters").max(2000),
  });

  app.post("/api/contact", async (req, res) => {
    try {
      // Rate limiting for contact form: 3 submissions per IP per minute
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const rateLimitKey = `contact:${ip}`;
      if (!checkRateLimit(rateLimitKey, 3, 60000)) {
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }

      const parsed = contactFormSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { name, email, message } = parsed.data;

      const success = await sendContactFormEmail(name, email, message);

      if (success) {
        res.json({ success: true, message: "Message sent successfully" });
      } else {
        res.status(500).json({ message: "Failed to send message. Please try again." });
      }
    } catch (error) {
      console.error("Contact form error:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

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

      // Use X-Forwarded-Proto for correct HTTPS detection behind reverse proxies
      const host = req.get('host');
      const forwardedProto = req.headers['x-forwarded-proto'];
      const protocol = forwardedProto ? String(forwardedProto).split(',')[0].trim() : req.protocol;
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

      // Security validation: sheets array is now required and must match sheetCount
      // Prevents pricing exploit where client sends low sheetCount with many sheets
      // or omits sheets array entirely to bypass validation
      if (sheets.length !== sheetCount) {
        return res.status(400).json({
          message: `Sheet count mismatch: claimed ${sheetCount} but provided ${sheets.length} sheets`
        });
      }

      const totalPriceSar = sheetCount * PRICE_PER_SHEET_SAR;

      // Use transactional method to ensure atomicity
      // If server crashes between order and sheets creation, both will be rolled back
      const order = await storage.createOrderWithSheets({
        userId,
        sheetCount,
        totalPriceSar,
        status: "pending",
      }, sheets);

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

      // Use Moyasar instead of Stripe
      const { createPayment } = await import("./moyasarClient");
      const { getMoyasarPublishableKey } = await import("./moyasarClient");

      // For redirect-based flow, we can use a simple hosted payment page or build one.
      // Moyasar's hosted form is the easiest path for now.
      // However, createPayment API is for S2S or when we have the token.
      // For web redirect flow, we typically use the JS library on frontend, OR
      // we can create an invoice. Let's check Moyasar API docs for "Invoice" or "Hosted Payment".

      // Re-reading docs (from memory/previous steps): 
      // "To address this issue, Moyasar has implemented a publishable API key... to initiate payments directly from the frontend"
      // It seems simpler to redirect the user to a frontend page that renders the Moyasar form.
      // But preserving the existing backend flow structure:

      // Let's redirect to a frontend payment page with the order ID.
      // The frontend will use the Moyasar JS library to handle the payment.
      // This is better than backend-initiated redirect for modern gateways.

      // BUT, to keep changes minimal and "backend-driven" like Stripe Checkout:
      // We'll redirect to a local page /payment/:orderId which expects the user to pay.
      // Let's verify if we can create a "Payment Link" via API. 
      // We saw "Create Invoice" in the plan. Let's use that if available.
      // The `read_url_content` for invoices 404'd. 

      // PLAN B: Redirect to frontend payment page.
      // The Stripe implementation redirected to `session.url`.
      // We will redirect to `/payment/${orderId}` on our own frontend.
      // The frontend will fetch order details -> show Moyasar form -> post to callback.

      // Actually, let's implement the `createPayment` behavior if we were to do it server-side?
      // No, strictly 3DS requires frontend interaction usually.

      return res.redirect(`/payment/${orderId}`);

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

      // Security validation: sheets array is now required and must match sheetCount
      // Prevents pricing exploit where client sends low sheetCount with many sheets
      // or omits sheets array entirely to bypass validation
      if (sheets.length !== sheetCount) {
        return res.status(400).json({
          message: `Sheet count mismatch: claimed ${sheetCount} but provided ${sheets.length} sheets`
        });
      }

      const totalPriceSar = sheetCount * PRICE_PER_SHEET_SAR;

      // Use transactional method to ensure atomicity
      // If server crashes between order and sheets creation, both will be rolled back
      const order = await storage.createOrderWithSheets({
        userId,
        sheetCount,
        totalPriceSar,
        status: "pending",
      }, sheets);

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

      // Send user to frontend payment page (Moyasar-based)
      const domain = process.env.REPLIT_DOMAINS?.split(',')[0] || 'localhost:5000';
      const frontendPaymentUrl = `https://${domain}/payment/${order.id}`;

      res.status(201).json({
        order,
        checkoutUrl: frontendPaymentUrl
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

  app.get("/api/moyasar/config", async (req, res) => {
    try {
      const { getMoyasarPublishableKey } = await import("./moyasarClient");
      res.json({ publishableKey: getMoyasarPublishableKey() });
    } catch (error) {
      console.error("Error getting Moyasar config:", error);
      res.status(500).json({ message: "Failed to get config" });
    }
  });

  // Moyasar checkout for order payments (credit card flow)
  // This is called by PaymentPage.tsx when user clicks "Pay with Credit Card"
  app.post("/api/moyasar/checkout/:orderId", isAuthenticated, async (req: any, res) => {
    try {
      const { orderId } = req.params;
      const userId = req.dbUser.id;

      const order = await storage.getOrder(orderId);
      if (!order || order.userId !== userId) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.status !== 'pending') {
        return res.status(400).json({ message: "Order is already processed or paid" });
      }

      const { createPayment } = await import("./moyasarClient");

      // Amount in Halalas (1 SAR = 100 Halalas)
      const amountInHalalas = order.totalPriceSar * 100;

      const domain = process.env.REPLIT_DOMAINS?.split(',')[0] || 'localhost:5000';

      const payment = await createPayment({
        amount: amountInHalalas,
        currency: "SAR",
        description: `LOD 400 Upgrade - Order #${order.id.slice(-8)} (${order.sheetCount} sheets)`,
        callback_url: `https://${domain}/api/orders/${orderId}/payment-callback`,
        metadata: {
          orderId: order.id,
          userId: userId,
          type: "order_payment"
        }
      });

      // Store payment ID for verification in callback
      await storage.updateOrder(orderId, { moyasarPaymentId: payment.id });

      // Return 3DS redirect URL
      res.json({
        url: payment.source?.transaction_url || `https://moyasar.com/payment/${payment.id}`,
        paymentId: payment.id
      });

    } catch (error: any) {
      console.error("Moyasar checkout error:", error);
      res.status(500).json({ message: "Payment initialization failed" });
    }
  });

  // Callback after Moyasar order payment (3DS redirect)
  app.get("/api/orders/:orderId/payment-callback", async (req: any, res) => {
    const { orderId } = req.params;
    const { id: paymentId, status, message } = req.query;

    if (status === "paid") {
      try {
        // Verify payment matches order
        const order = await storage.getOrder(orderId);
        if (order && order.moyasarPaymentId === paymentId) {
          await storage.updateOrderStatus(orderId, "paid");

          // Send confirmation email
          const orderWithUser = await storage.getOrderWithFiles(orderId);
          if (orderWithUser?.user?.email) {
            sendOrderPaidEmail(
              orderWithUser.user.email,
              orderId,
              orderWithUser.sheetCount,
              orderWithUser.user.firstName || undefined
            ).catch(err => console.error('Failed to send paid email:', err));
          }
        }

        res.redirect(`/?payment=success&order=${orderId}`);
      } catch (err) {
        console.error("Payment callback error:", err);
        res.redirect(`/?payment=error&order=${orderId}`);
      }
    } else {
      res.redirect(`/?payment=failed&order=${orderId}&message=${encodeURIComponent(message || 'Payment failed')}`);
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

  // ============================================
  // BALANCE & COMPANY ROUTES
  // ============================================

  app.get("/api/balance", isAuthenticated, async (req: any, res) => {
    try {
      const { BalanceService } = await import("./balanceService");
      const balances = await BalanceService.getUserBalances(req.dbUser.id);
      res.json(balances);
    } catch (error) {
      console.error("Error getting balances:", error);
      res.status(500).json({ message: "Failed to get balances" });
    }
  });

  app.post("/api/balance/topup", isAuthenticated, async (req: any, res) => {
    try {
      const { amountSar, companyId } = req.body;

      if (!amountSar || amountSar <= 0) {
        return res.status(400).json({ message: "Amount must be positive" });
      }

      const { BalanceService } = await import("./balanceService");

      // If companyId is provided, verify membership
      if (companyId) {
        // TODO: add specific permission check for "admin" role if needed
      }

      const result = await BalanceService.initiateTopUp(req.dbUser.id, amountSar, companyId);

      // Construct payment URL
      const { buildPaymentFormUrl } = await import("./moyasarClient");
      const paymentUrl = buildPaymentFormUrl(result.paymentId);

      res.json({ ...result, paymentUrl });
    } catch (error) {
      console.error("Error initiating top-up:", error);
      res.status(500).json({ message: "Failed to initiate top-up" });
    }
  });

  // Callback for Moyasar after top-up payment
  app.get("/api/balance/topup-callback", async (req: any, res) => {
    // Moyasar redirects here with status, id, message
    const { id, status, message } = req.query;

    // We display a success/failure page to the user
    // The actual credit happens via webhook asynchronously
    if (status === "paid") {
      res.redirect(`/?balance_topup=success&payment_id=${id}`);
    } else {
      res.redirect(`/?balance_topup=failed&message=${message}`);
    }
  });

  app.post("/api/orders/:orderId/pay-with-balance", isAuthenticated, async (req: any, res) => {
    try {
      const { orderId } = req.params;
      const { companyId } = req.body;
      const userId = req.dbUser.id;

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { BalanceService } = await import("./balanceService");

      try {
        await BalanceService.payOrderWithBalance(userId, orderId, companyId);

        // Send email notification (reusing service logic)
        const user = await storage.getUser(userId);
        if (user?.email) {
          import("./emailService").then(service => {
            service.sendOrderPaidEmail(
              user.email!,
              orderId,
              order.sheetCount,
              user.firstName || undefined
            ).catch(console.error);
          });
        }

        res.json({ success: true });
      } catch (err: any) {
        return res.status(400).json({ message: err.message || "Payment failed" });
      }
    } catch (error) {
      console.error("Error paying with balance:", error);
      res.status(500).json({ message: "Failed to process payment" });
    }
  });

  // ============================================
  // REFUND & ORDER MANEGEMENT ROUTES
  // ============================================

  app.post("/api/orders/:orderId/refund-request", isAuthenticated, async (req: any, res) => {
    try {
      const { orderId } = req.params;
      const { note } = req.body;
      const userId = req.dbUser.id;

      // Check ownership
      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.userId !== userId) return res.status(403).json({ message: "Forbidden" });

      const { BalanceService } = await import("./balanceService");
      await BalanceService.requestRefund(userId, orderId, note);

      res.json({ success: true, message: "Refund request submitted" });
    } catch (error: any) {
      console.error("Error requesting refund:", error);
      res.status(400).json({ message: error.message || "Failed to request refund" });
    }
  });

  // Admin routes for refunds
  app.get("/api/admin/refunds", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const requests = await storage.getPendingRefundRequests();
      res.json(requests);
    } catch (error) {
      console.error("Error getting refund requests:", error);
      res.status(500).json({ message: "Failed to get refund requests" });
    }
  });
  app.get("/api/admin/refunds", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      // Determine if we need to filter? For now return all pending.
      // We need to join with users and orders.
      // Using simple query for now.
      const requests = await storage.getPendingRefundRequests();
      // Wait, storage doesn't have this method. 
      // We can use db directly here or add to storage.
      // Since we are in routes, and storage is DatabaseStorage, we can add it there or use direct db access via import if we want, 
      // but better to keep abstraction or use BalanceService if appropriate?
      // BalanceService is for logic. Storage for data access. 
      // Let's add getPendingRefundRequests to storage interface/implementation.
      // OR just duplicate logic here for speed if acceptable. 
      // "storage" variable is available.
      // Let's assume we will add it to storage.ts in a moment.
      res.json(requests);
    } catch (error) {
      console.error("Error getting refund requests:", error);
      res.status(500).json({ message: "Failed to get refund requests" });
    }
  });

  app.post("/api/admin/refunds/:transactionId/approve", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { transactionId } = req.params;
      const { BalanceService } = await import("./balanceService");

      await BalanceService.approveRefund(req.dbUser.id, transactionId);
      res.json({ success: true, message: "Refund approved" });
    } catch (error: any) {
      console.error("Error approving refund:", error);
      res.status(400).json({ message: error.message || "Failed to approve refund" });
    }
  });

  app.post("/api/admin/refunds/:transactionId/reject", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { transactionId } = req.params;
      const { note } = req.body;
      const { BalanceService } = await import("./balanceService");

      await BalanceService.rejectRefund(req.dbUser.id, transactionId, note);
      res.json({ success: true, message: "Refund rejected" });
    } catch (error: any) {
      console.error("Error rejecting refund:", error);
      res.status(400).json({ message: error.message || "Failed to reject refund" });
    }
  });

  // ============================================
  // COMPANY ROUTES
  // ============================================

  app.post("/api/companies", isAuthenticated, async (req: any, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ message: "Company name is required" });
      }

      const company = await storage.createCompany(name, req.dbUser.id);
      res.json(company);
    } catch (error) {
      console.error("Error creating company:", error);
      res.status(500).json({ message: "Failed to create company" });
    }
  });

  app.get("/api/companies/:companyId", isAuthenticated, async (req: any, res) => {
    try {
      const { companyId } = req.params;
      const company = await storage.getCompany(companyId);

      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      // Check membership
      const members = await storage.getCompanyMembers(companyId);
      const isMember = members.some(m => m.userId === req.dbUser.id);

      if (!isMember) {
        return res.status(403).json({ message: "Not a member of this company" });
      }

      res.json(company);
    } catch (error) {
      console.error("Error getting company:", error);
      res.status(500).json({ message: "Failed to get company" });
    }
  });

  app.get("/api/companies/:companyId/members", isAuthenticated, async (req: any, res) => {
    try {
      const { companyId } = req.params;

      // Check membership
      const members = await storage.getCompanyMembers(companyId);
      const isMember = members.some(m => m.userId === req.dbUser.id);

      if (!isMember) {
        return res.status(403).json({ message: "Not a member of this company" });
      }

      // Populate user details for members if needed (requires join or separate fetch)
      // For now returning member records (userId, role, etc)
      // Ideally we should return user names/emails.
      // Let's fetch user details for each member.
      const membersWithDetails = await Promise.all(members.map(async (m) => {
        const user = await storage.getUser(m.userId);
        return {
          ...m,
          firstName: user?.firstName,
          lastName: user?.lastName,
          email: user?.email // Be careful leaking emails if not admin?
        };
      }));

      res.json(membersWithDetails);
    } catch (error) {
      console.error("Error getting company members:", error);
      res.status(500).json({ message: "Failed to get members" });
    }
  });

  app.post("/api/companies/:companyId/members", isAuthenticated, async (req: any, res) => {
    try {
      const { companyId } = req.params;
      const { email, role } = req.body;

      if (!email || !/\S+@\S+\.\S+/.test(email)) {
        return res.status(400).json({ message: "Valid email required" });
      }

      // Check permissions (must be admin of company)
      const members = await storage.getCompanyMembers(companyId);
      const currentUserMember = members.find(m => m.userId === req.dbUser.id);

      if (!currentUserMember || currentUserMember.role !== "admin") {
        return res.status(403).json({ message: "Only company admins can add members" });
      }

      await storage.addCompanyMember(companyId, email, role || "member");
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error adding member:", error);
      res.status(400).json({ message: error.message || "Failed to add member" });
    }
  });

  app.delete("/api/companies/:companyId/members/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const { companyId, userId: targetUserId } = req.params;

      // Check permissions
      const members = await storage.getCompanyMembers(companyId);
      const currentUserMember = members.find(m => m.userId === req.dbUser.id);

      if (!currentUserMember || currentUserMember.role !== "admin") {
        // Allow users to leave company themselves?
        if (targetUserId !== req.dbUser.id) {
          return res.status(403).json({ message: "Only company admins can remove other members" });
        }
      }

      // Prevent removing the last admin? (Edge case, but good to have)
      // For now simple removal.

      await storage.removeCompanyMember(companyId, targetUserId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing member:", error);
      res.status(500).json({ message: "Failed to remove member" });
    }
  });

  return httpServer;
}

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrations } from 'stripe-replit-sync';
import { getStripeSync } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq, ne } from "drizzle-orm";

// Require ADMIN_EMAIL to be explicitly set - no hardcoded fallback for security
if (!process.env.ADMIN_EMAIL) {
  throw new Error("FATAL: ADMIN_EMAIL environment variable must be set");
}
const SUPER_ADMIN_EMAIL = process.env.ADMIN_EMAIL;

async function ensureSuperAdmin() {
  try {
    // Make the designated email the only admin (isAdmin is integer: 0 = false, 1 = true)
    await db.update(users).set({ isAdmin: 0 }).where(ne(users.email, SUPER_ADMIN_EMAIL));
    await db.update(users).set({ isAdmin: 1 }).where(eq(users.email, SUPER_ADMIN_EMAIL));
    log(`Super admin configured: ${SUPER_ADMIN_EMAIL}`, "auth");
  } catch (error: any) {
    log(`Error configuring super admin: ${error.message}`, "auth");
  }
}

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    log('DATABASE_URL not set, skipping Stripe initialization', 'stripe');
    return;
  }

  try {
    log('Initializing Stripe schema...', 'stripe');
    await runMigrations({
      databaseUrl,
      schema: 'stripe'
    });
    log('Stripe schema ready', 'stripe');

    const stripeSync = await getStripeSync();

    log('Setting up managed webhook...', 'stripe');
    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    const webhookResult = await stripeSync.findOrCreateManagedWebhook(
      `${webhookBaseUrl}/api/stripe/webhook`
    );

    if (webhookResult?.webhook?.url) {
      log(`Webhook configured: ${webhookResult.webhook.url}`, 'stripe');
    } else {
      log('Webhook setup completed', 'stripe');
    }

    log('Syncing Stripe data...', 'stripe');
    stripeSync.syncBackfill()
      .then(() => {
        log('Stripe data synced', 'stripe');
      })
      .catch((err: Error) => {
        log(`Error syncing Stripe data: ${err.message}`, 'stripe');
      });
  } catch (error: any) {
    log(`Failed to initialize Stripe: ${error.message}`, 'stripe');
  }
}

(async () => {
  try {
    // Log TEST_MODE status at startup
    if (process.env.TEST_MODE === "true") {
      log("TEST MODE ACTIVE - Payments are bypassed", "config");
    }

    // Register Stripe webhook route FIRST (before json middleware)
    // stripe-replit-sync integration pattern
    app.post(
      '/api/stripe/webhook',
      express.raw({ type: 'application/json' }),
      async (req, res) => {
        const signature = req.headers['stripe-signature'];

        if (!signature) {
          return res.status(400).json({ error: 'Missing stripe-signature' });
        }

        try {
          const sig = Array.isArray(signature) ? signature[0] : signature;

          if (!Buffer.isBuffer(req.body)) {
            log('Webhook error: req.body is not a Buffer', 'stripe');
            return res.status(500).json({ error: 'Webhook processing error' });
          }

          await WebhookHandlers.processWebhook(req.body as Buffer, sig);

          res.status(200).json({ received: true });
        } catch (error: any) {
          log(`Webhook error: ${error.message}`, 'stripe');
          res.status(400).json({ error: 'Webhook processing error' });
        }
      }
    );

    app.use(
      express.json({
        verify: (req, _res, buf) => {
          req.rawBody = buf;
        },
      }),
    );

    app.use(express.urlencoded({ extended: false }));

    app.use((req, res, next) => {
      const start = Date.now();
      const path = req.path;
      let capturedJsonResponse: Record<string, any> | undefined = undefined;

      const originalResJson = res.json;
      res.json = function (bodyJson, ...args) {
        capturedJsonResponse = bodyJson;
        return originalResJson.apply(res, [bodyJson, ...args]);
      };

      res.on("finish", () => {
        const duration = Date.now() - start;
        if (path.startsWith("/api")) {
          let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
          if (capturedJsonResponse) {
            logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
          }

          log(logLine);
        }
      });

      next();
    });

    await registerRoutes(httpServer, app);

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      res.status(status).json({ message });
      console.error(err);
    });

    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    const port = parseInt(process.env.PORT || "5000", 10);

    // Start listening FIRST, then initialize external services
    httpServer.listen(
      {
        port,
        host: "0.0.0.0",
        reusePort: true,
      },
      () => {
        log(`serving on port ${port}`);

        // Ensure super admin is configured
        ensureSuperAdmin().catch((err) => {
          log(`Admin setup error: ${err.message}`, 'auth');
        });

        // Initialize Stripe in the background AFTER server is listening
        initStripe().catch((err) => {
          log(`Stripe initialization error: ${err.message}`, 'stripe');
        });

        // Start cron jobs
        import("./cron").then(({ startOrderCleanupJob }) => {
          startOrderCleanupJob();
        }).catch(err => {
          log(`Failed to start cron jobs: ${err.message}`, 'cron');
        });
      },
    );
  } catch (error: any) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})();

import session from "express-session";
import type { Express, RequestHandler, Request, Response, NextFunction } from "express";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true, // Auto-create sessions table on fresh deployments
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  // In production or on Replit (which always uses HTTPS proxy), use secure cookies
  // For local development without HTTPS, allow insecure cookies
  const isSecure = process.env.NODE_ENV === "production" || !!process.env.REPL_ID;
  
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());

  // Simple logout route - clears the session
  app.post("/api/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Error destroying session:", err);
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out successfully" });
    });
  });

  // GET logout for easy redirect
  app.get("/api/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      res.clearCookie("connect.sid");
      res.redirect("/");
    });
  });
}

// Middleware to check if user is authenticated via session
export const isAuthenticated: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Verify user still exists in database
  const user = await storage.getUser(userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Attach user to request for downstream use
  (req as any).dbUser = user;
  return next();
};

// Middleware to check if user is an admin
export const isAdmin: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = await storage.getUser(userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!user.isAdmin) {
    return res.status(403).json({ message: "Forbidden - Admin access required" });
  }

  (req as any).dbUser = user;
  return next();
};

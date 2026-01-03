
import { db } from "./db";
import { orders } from "@shared/schema";
import { lt, and, eq } from "drizzle-orm";
import { log } from "./index";

/**
 * Starts the periodic cleanup job for expired orders.
 * Orders pending for more than 7 days are marked as expired.
 */
export function startOrderCleanupJob() {
    const CHECK_INTERVAL_MS = 60 * 60 * 1000; // Run every hour
    const EXPIRATION_DAYS = 7;

    log("Starting order cleanup job...", "cron");

    const runCleanup = async () => {
        try {
            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() - EXPIRATION_DAYS);

            // Find and expire old pending orders
            // Note: We might want to check for 'pending_payment' specifically if we have other states
            // but 'pending' usually means unpaid.

            const result = await db.update(orders)
                .set({ status: "expired" })
                .where(
                    and(
                        eq(orders.status, "pending"),
                        lt(orders.createdAt, expirationDate)
                    )
                )
                .returning({ id: orders.id });

            if (result.length > 0) {
                log(`Expired ${result.length} old pending orders. IDs: ${result.map(o => o.id).join(", ")}`, "cron");
            }
        } catch (error: any) {
            log(`Error running order cleanup: ${error.message}`, "cron");
        }
    };

    // Run immediately on startup
    runCleanup();

    // Schedule periodic run
    setInterval(runCleanup, CHECK_INTERVAL_MS);
}

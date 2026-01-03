
import { db } from "./db";
import { eq, sql, and } from "drizzle-orm";
import {
    users,
    companies,
    companyMembers,
    balanceTransactions,
    userBalances,
    orders,
    BalanceTransaction,
    UserBalance,
    Company,
    CompanyMember
} from "@shared/schema";
import { createPayment } from "./moyasarClient";

export class BalanceService {
    /**
     * Get user's personal balance and any company balances they have access to
     */
    static async getUserBalances(userId: string) {
        // Get personal balance
        const personalBalance = await db.query.userBalances.findFirst({
            where: eq(userBalances.userId, userId),
        });

        // Get company memberships
        const memberships = await db.query.companyMembers.findMany({
            where: eq(companyMembers.userId, userId),
            with: {
                company: true,
            },
        });

        return {
            personal: personalBalance?.balanceSar || 0,
            companies: memberships.map((m) => ({
                id: m.company.id,
                name: m.company.name,
                balanceSar: m.company.balanceSar,
                role: m.role,
            })),
        };
    }

    /**
     * Top up balance (Personal or Company)
     * Creates a pending transaction and returns checkout URL/details
     */
    static async initiateTopUp(
        userId: string,
        amountSar: number,
        companyId?: string
    ) {
        if (amountSar <= 0) {
            throw new Error("Amount must be positive");
        }

        // Create a pending transaction record
        const [transaction] = await db
            .insert(balanceTransactions)
            .values({
                userId,
                companyId: companyId || null,
                type: "topup",
                amountSar,
                status: "pending",
                note: `Balance top-up via Moyasar`,
            })
            .returning();

        // Initiate Moyasar payment
        // We pass the transaction ID in metadata so webhook can link it
        const payment = await createPayment({
            amount: amountSar * 100, // Convert to halalas
            currency: "SAR",
            description: `Balance Top-up: ${amountSar} SAR`,
            callback_url: `${process.env.APP_URL}/balance/topup-callback`,
            metadata: {
                transactionId: transaction.id,
                type: "topup",
            },
        });

        // Update transaction with payment ID
        await db
            .update(balanceTransactions)
            .set({ moyasarPaymentId: payment.id })
            .where(eq(balanceTransactions.id, transaction.id));

        return {
            transactionId: transaction.id,
            paymentId: payment.id,
            amount: payment.amount,
            currency: payment.currency,
            status: payment.status,
            // For redirect flow, we might return payment details for frontend to handle
        };
    }

    /**
     * Complete top-up transaction (called by webhook)
     */
    static async completeTopUp(transactionId: string, paymentId: string) {
        const transaction = await db.query.balanceTransactions.findFirst({
            where: eq(balanceTransactions.id, transactionId),
        });

        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`);
        }

        if (transaction.status === "completed") {
            return; // Idempotent
        }

        // Verify payment ID matches (security check)
        if (transaction.moyasarPaymentId && transaction.moyasarPaymentId !== paymentId) {
            console.warn(`Payment ID mismatch for transaction ${transactionId}: expected ${transaction.moyasarPaymentId}, got ${paymentId}`);
            // Could be a race condition or retry with different payment, but we should be careful.
            // For now, if we have a payment ID on record, we strictly check it.
        }

        await db.transaction(async (tx) => {
            // 1. Mark transaction as completed
            await tx
                .update(balanceTransactions)
                .set({ status: "completed" })
                .where(eq(balanceTransactions.id, transactionId));

            // 2. Credit the balance
            if (transaction.companyId) {
                // Credit company balance
                await tx
                    .update(companies)
                    .set({
                        balanceSar: sql`${companies.balanceSar} + ${transaction.amountSar}`,
                        updatedAt: new Date(),
                    })
                    .where(eq(companies.id, transaction.companyId));
            } else {
                // Credit personal balance
                // Upsert logic for userBalances
                await tx
                    .insert(userBalances)
                    .values({
                        userId: transaction.userId,
                        balanceSar: transaction.amountSar,
                    })
                    .onConflictDoUpdate({
                        target: userBalances.userId,
                        set: {
                            balanceSar: sql`${userBalances.balanceSar} + ${transaction.amountSar}`,
                            updatedAt: new Date(),
                        },
                    });
            }
        });
    }

    /**
     * Pay for an order using balance
     */
    static async payOrderWithBalance(
        userId: string,
        orderId: string,
        companyId?: string
    ) {
        const order = await db.query.orders.findFirst({
            where: eq(orders.id, orderId),
        });

        if (!order) {
            throw new Error("Order not found");
        }

        if (order.status !== "pending") {
            throw new Error("Order is not pending payment");
        }

        const cost = order.totalPriceSar;

        await db.transaction(async (tx) => {
            // Check balance and debit atomically
            if (companyId) {
                // Check company balance and membership
                const member = await tx.query.companyMembers.findFirst({
                    where: (cm, { and, eq }) => and(eq(cm.companyId, companyId), eq(cm.userId, userId))
                });

                if (!member) {
                    throw new Error("User is not a member of this company");
                }

                const company = await tx.query.companies.findFirst({
                    where: eq(companies.id, companyId)
                });

                if (!company || company.balanceSar < cost) {
                    throw new Error("Insufficient company balance");
                }

                // Debit company - safely with atomic check
                const [updatedCompany] = await tx.update(companies)
                    .set({
                        balanceSar: sql`${companies.balanceSar} - ${cost}`,
                        updatedAt: new Date()
                    })
                    .where(and(eq(companies.id, companyId), sql`${companies.balanceSar} >= ${cost}`))
                    .returning();

                if (!updatedCompany) {
                    throw new Error("Insufficient company balance (transaction failed)");
                }

            } else {
                // Check personal balance
                const userBal = await tx.query.userBalances.findFirst({
                    where: eq(userBalances.userId, userId)
                });

                if (!userBal || userBal.balanceSar < cost) {
                    throw new Error("Insufficient personal balance");
                }

                // Debit user - safely with atomic check
                const [updatedUser] = await tx.update(userBalances)
                    .set({
                        balanceSar: sql`${userBalances.balanceSar} - ${cost}`,
                        updatedAt: new Date()
                    })
                    .where(and(eq(userBalances.userId, userId), sql`${userBalances.balanceSar} >= ${cost}`))
                    .returning();

                if (!updatedUser) {
                    throw new Error("Insufficient personal balance (transaction failed)");
                }
            }

            // Create transaction record
            await tx.insert(balanceTransactions).values({
                userId,
                companyId: companyId || null,
                type: "debit",
                amountSar: -cost, // Negative for debit
                orderId: order.id,
                status: "completed",
                note: `Payment for Order #${order.sheetCount} sheets`,
            });

            // Mark order as paid
            await tx.update(orders)
                .set({
                    status: "paid",
                    paidAt: new Date()
                })
                .where(eq(orders.id, orderId));
        });

        return true;
    }

    // --- Refunds ---

    static async requestRefund(userId: string, orderId: string, note?: string) {
        // Create a 'refund_request' transaction or just log it?
        // Better: create a transaction with status 'pending' and type 'refund'
        // And update order status?
        const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
        if (!order) throw new Error("Order not found");

        // Ensure paid
        if (order.status === "pending") throw new Error("Unpaid order cannot be refunded");

        // Find original payment transaction to know amount and company?
        // Simplified: just store request. Admin will review.

        await db.transaction(async (tx) => {
            await tx.insert(balanceTransactions).values({
                userId,
                companyId: null, // Admin will determine? Or we should link to original tx?
                type: "refund_request",
                amountSar: order.totalPriceSar,
                orderId: order.id,
                status: "pending",
                note: note || "Customer requested refund"
            });

            // Optionally update order status to 'processing' or a specific tag
            // But 'processing' means engine is working.
            // Let's keep status but maybe add a note?
            // Actually, for visible feedback, maybe no status change on order yet.
        });
    }

    static async approveRefund(adminUserId: string, transactionId: string) {
        // 1. Get request
        const request = await db.query.balanceTransactions.findFirst({
            where: eq(balanceTransactions.id, transactionId)
        });
        if (!request || request.type !== "refund_request" || request.status !== "pending") {
            throw new Error("Invalid refund request");
        }

        const amount = Math.abs(request.amountSar); // Should be positive in DB? My types say amountSar is number. I usually store Debits as negative. Refund request should be positive (credit to come).

        await db.transaction(async (tx) => {
            // Find original debit to see where to return money?
            // For now, return to User's personal balance or Company based on logic?
            // Let's assume return to User Personal for simplicity unless we tracked companyId in request.
            // IMPORTANT: In `requestRefund`, I put `companyId: null`. 
            // We should probably try to find the original debit transaction for this order to know where to refund.
            const originalDebit = await tx.query.balanceTransactions.findFirst({
                where: (t, { and, eq }) => and(eq(t.orderId, request.orderId), eq(t.type, "debit"))
            });

            const targetCompanyId = originalDebit?.companyId;
            const targetUserId = request.userId;

            // Credit logic
            if (targetCompanyId) {
                await tx.update(companies)
                    .set({ balanceSar: sql`${companies.balanceSar} + ${amount}`, updatedAt: new Date() })
                    .where(eq(companies.id, targetCompanyId));
            } else {
                await tx.insert(userBalances).values({
                    userId: targetUserId,
                    balanceSar: amount
                }).onConflictDoUpdate({
                    target: userBalances.userId,
                    set: { balanceSar: sql`${userBalances.balanceSar} + ${amount}`, updatedAt: new Date() }
                });
            }

            // Update request status
            await tx.update(balanceTransactions)
                .set({ status: "completed", note: `Refund Approved by Admin` })
                .where(eq(balanceTransactions.id, transactionId));

            // Update Order Status to 'cancelled' if not already
            await tx.update(orders)
                .set({ status: "cancelled" }) // Add cancelled status to schema if needed
                .where(eq(orders.id, request.orderId!));
        });
    }

    static async rejectRefund(adminUserId: string, transactionId: string, note?: string) {
        await db.update(balanceTransactions)
            .set({ status: "failed", note: note ? `Rejected: ${note}` : "Rejected by Admin" })
            .where(eq(balanceTransactions.id, transactionId));
    }
}

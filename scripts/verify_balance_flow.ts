
import { db } from "../server/db";
import { BalanceService } from "../server/balanceService";
import { users, companies, companyMembers, orders, balanceTransactions, userBalances } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Starting Balance Service Verification...");

    // 1. Setup Test User and Company
    console.log("Setting up test data...");
    const [user] = await db.insert(users).values({
        username: "test_user_" + Date.now(),
        password: "hashed_password",
        email: "test_" + Date.now() + "@example.com",
        role: "customer"
    }).returning();

    const [company] = await db.insert(companies).values({
        name: "Test Company " + Date.now(),
        balanceSar: 0
    }).returning();

    await db.insert(companyMembers).values({
        userId: user.id,
        companyId: company.id,
        role: "admin"
    });

    console.log(`Created User: ${user.id}`);
    console.log(`Created Company: ${company.id}`);

    // 2. Test Personal Top-up
    console.log("\n--- Testing Personal Top-up ---");
    const topUpAmount = 500;
    const topUpTx = await BalanceService.initiateTopUp(user.id, topUpAmount);
    console.log(`Initiated Top-up TX: ${topUpTx.transactionId}`);

    // Simulate Webhook completion
    await BalanceService.completeTopUp(topUpTx.transactionId, topUpTx.paymentId);
    console.log("Completed Top-up");

    const balancesAfterTopUp = await BalanceService.getUserBalances(user.id);
    console.log("Balances after top-up:", balancesAfterTopUp);
    if (balancesAfterTopUp.personal !== topUpAmount) {
        throw new Error(`Expected personal balance ${topUpAmount}, got ${balancesAfterTopUp.personal}`);
    }

    // 3. Test Company Top-up
    console.log("\n--- Testing Company Top-up ---");
    const companyTopUpAmount = 1000;
    const compTopUpTx = await BalanceService.initiateTopUp(user.id, companyTopUpAmount, company.id);
    await BalanceService.completeTopUp(compTopUpTx.transactionId, compTopUpTx.paymentId);

    const balancesAfterCompTopUp = await BalanceService.getUserBalances(user.id);
    console.log("Balances after company top-up:", balancesAfterCompTopUp);
    const companyBal = balancesAfterCompTopUp.companies.find(c => c.id === company.id);
    if (companyBal?.balanceSar !== companyTopUpAmount) {
        throw new Error(`Expected company balance ${companyTopUpAmount}, got ${companyBal?.balanceSar}`);
    }

    // 4. Test Order Payment (Personal)
    console.log("\n--- Testing Order Payment (Personal) ---");
    // Create dummy order
    const [order] = await db.insert(orders).values({
        orderNumber: "ORD-" + Date.now(),
        userId: user.id,
        totalPriceSar: 100,
        status: "pending",
        sheetCount: 1,
        tier: "timely",
        deliveryDate: new Date()
    }).returning();

    await BalanceService.payOrderWithBalance(user.id, order.id);
    console.log(`Paid for order ${order.id} with personal balance`);

    const balancesAfterPay = await BalanceService.getUserBalances(user.id);
    console.log("Balances after payment:", balancesAfterPay);
    if (balancesAfterPay.personal !== (topUpAmount - 100)) {
        throw new Error(`Expected personal balance ${topUpAmount - 100}, got ${balancesAfterPay.personal}`);
    }

    // 5. Test Insufficient Funds
    console.log("\n--- Testing Insufficient Funds ---");
    const [expensiveOrder] = await db.insert(orders).values({
        orderNumber: "EXP-" + Date.now(),
        userId: user.id,
        totalPriceSar: 10000,
        status: "pending",
        sheetCount: 100,
        tier: "timely",
        deliveryDate: new Date()
    }).returning();

    try {
        await BalanceService.payOrderWithBalance(user.id, expensiveOrder.id);
        throw new Error("Should have failed with insufficient funds");
    } catch (e: any) {
        console.log("Caught expected error:", e.message);
        if (!e.message.includes("Insufficient")) throw e;
    }

    // 6. Test Refund Request
    console.log("\n--- Testing Refund Request ---");
    await BalanceService.requestRefund(user.id, order.id, "Test Refund");
    console.log("Refund requested");

    const [refundTx] = await db.select().from(balanceTransactions)
        .where(eq(balanceTransactions.orderId, order.id)); // Assuming orderId logic from previous steps

    // Note: requestRefund inserts a new transaction.
    const refundReq = await db.query.balanceTransactions.findFirst({
        where: (t, { and, eq }) => and(eq(t.orderId, order.id), eq(t.type, "refund_request"))
    });

    if (!refundReq) throw new Error("Refund request transaction not found");
    console.log("Refund request found:", refundReq.id);

    // 7. Approve Refund
    console.log("\n--- Testing Refund Approval ---");
    await BalanceService.approveRefund(user.id, refundReq.id); // Admin approval
    console.log("Refund approved");

    const balancesAfterRefund = await BalanceService.getUserBalances(user.id);
    // Should have been credited back to personal balance (logic in approveRefund defaults to user if no companyId on debit found or fallback)
    // Wait, payOrderWithBalance(user.id, order.id) used Personal balance (companyId undefined).
    // Implementation of approveRefund: finds originalDebit.companyId. If undefined, credits userBalances.
    console.log("Balances after refund:", balancesAfterRefund);

    // Original balance was topUpAmount (500). Paid 100 -> 400. Refund 100 -> 500.
    if (balancesAfterRefund.personal !== topUpAmount) {
        throw new Error(`Expected personal balance restored to ${topUpAmount}, got ${balancesAfterRefund.personal}`);
    }

    console.log("\nSUCCESS: All verification steps passed!");
    process.exit(0);
}

main().catch(err => {
    console.error("Verification Failed:", err);
    process.exit(1);
});

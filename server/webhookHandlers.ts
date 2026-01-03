import { verifyWebhookSignature, getPayment } from './moyasarClient';
import { storage } from './storage';
import { sendOrderPaidEmail } from './emailService';

export class WebhookHandlers {
  static async processWebhook(payload: any, signature: string): Promise<void> {
    const webhookSecret = process.env.MOYASAR_WEBHOOK_SECRET;

    // In production, we must have a webhook secret
    if (!webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        console.error('MOYASAR_WEBHOOK_SECRET is not set');
        return;
      }
    }

    // Verify signature if secret is present
    if (webhookSecret && signature) {
      if (!verifyWebhookSignature(JSON.stringify(payload), signature, webhookSecret)) {
        throw new Error('Invalid webhook signature');
      }
    }

    const event = payload;

    // Moyasar events: payment.paid, payment.failed, etc.
    // The payload structure is { id: "...", type: "payment.paid", ... }

    console.log(`Received Moyasar webhook event: ${event.type}`);

    if (event.type === 'payment.paid') {
      const payment = event.data;
      await WebhookHandlers.handlePaymentPaid(payment);
    }
  }

  static async handlePaymentPaid(payment: any): Promise<void> {
    // We store the orderId in the payment metadata
    const orderId = payment.metadata?.orderId;

    if (orderId) {
      console.log(`Processing payment for order ${orderId}`);

      const order = await storage.getOrder(orderId);
      if (!order) {
        console.error(`Order ${orderId} not found for payment ${payment.id}`);
        return;
      }

      // Idempotency check: don't process if already paid
      if (order.status === 'paid' || order.status === 'processing' || order.status === 'complete' || order.status === 'uploaded') {
        console.log(`Order ${orderId} is already paid`);
        return;
      }

      await storage.updateOrder(orderId, {
        moyasarPaymentId: payment.id,
        moyasarInvoiceId: payment.invoice_id,
        status: "paid",
        paidAt: new Date()
      });

      console.log(`Order ${orderId} marked as paid`);

      // Send payment confirmation email
      if (order.user?.email) {
        sendOrderPaidEmail(
          order.user.email,
          orderId,
          order.sheetCount,
          order.user.firstName || undefined
        ).catch(err => console.error('Failed to send paid email:', err));
      } (order as any).user = order.user || await storage.getUser(order.userId); // Ensure user is loaded for email

      // Re-fetch with user for email if needed (files/user relations might be missing in basic getOrder)
      // The sendOrderPaidEmail function needs user email. 
      // storage.getOrder uses db.query.orders.findFirst({ with: { user: true } }) usually?
      // Let's verify getOrder implementation. 
      // Actually updateOrder returns the updated order without relations usually.
      // So let's fetch strictly for email.
      const fullOrder = await storage.getOrderWithFiles(orderId);
      if (fullOrder?.user?.email) {
        sendOrderPaidEmail(
          fullOrder.user.email,
          orderId,
          fullOrder.sheetCount,
          fullOrder.user.firstName || undefined
        ).catch(err => console.error('Failed to send paid email:', err));
      }
    } else {
      console.warn(`Payment ${payment.id} received without orderId in metadata`);
    }
  }
}

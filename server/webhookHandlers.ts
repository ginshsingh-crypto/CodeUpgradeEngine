import { getStripeSync } from './stripeClient';
import { storage } from './storage';
import { sendOrderPaidEmail } from './emailService';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    
    // stripe-replit-sync handles webhook verification and processing
    // It also emits events we can listen to for custom handling
    const result = await sync.processWebhook(payload, signature);
    
    // Handle specific events for our application logic
    if (result?.event) {
      const event = result.event;
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          await WebhookHandlers.handleCheckoutCompleted(session);
          break;
        }
        case 'checkout.session.expired': {
          const session = event.data.object;
          console.log(`Checkout session expired for order ${session.metadata?.orderId}`);
          break;
        }
      }
    }
  }

  static async handleCheckoutCompleted(session: any): Promise<void> {
    const orderId = session.metadata?.orderId;
    if (orderId) {
      await storage.updateOrder(orderId, {
        stripePaymentIntentId: session.payment_intent as string,
      });
      await storage.updateOrderStatus(orderId, "paid");
      console.log(`Order ${orderId} payment completed via webhook`);
      
      // Send payment confirmation email
      const order = await storage.getOrderWithFiles(orderId);
      if (order?.user?.email) {
        sendOrderPaidEmail(
          order.user.email,
          orderId,
          order.sheetCount,
          order.user.firstName || undefined
        ).catch(err => console.error('Failed to send paid email:', err));
      }
    }
  }
}

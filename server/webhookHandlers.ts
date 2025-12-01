import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string, uuid: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    
    const stripe = await getUncachableStripeClient();
    const webhooks = await stripe.webhookEndpoints.list({ limit: 10 });
    const webhookEndpoint = webhooks.data.find(w => w.url?.includes(uuid));
    
    if (!webhookEndpoint?.secret) {
      throw new Error('Webhook endpoint secret not found');
    }

    const event = stripe.webhooks.constructEvent(payload, signature, webhookEndpoint.secret);

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

    await sync.processWebhook(payload, signature, uuid);
  }

  static async handleCheckoutCompleted(session: any): Promise<void> {
    const orderId = session.metadata?.orderId;
    if (orderId) {
      await storage.updateOrder(orderId, {
        stripePaymentIntentId: session.payment_intent as string,
      });
      await storage.updateOrderStatus(orderId, "paid");
      console.log(`Order ${orderId} payment completed via webhook`);
    }
  }
}

/**
 * Moyasar Payment Gateway Client
 * 
 * Moyasar API uses HTTP Basic Auth with secret key as username.
 * Payments flow: initiated → paid/failed
 * 
 * @see https://docs.moyasar.com/api
 */

const MOYASAR_API_URL = "https://api.moyasar.com/v1";

interface MoyasarConfig {
    secretKey: string;
    publishableKey: string;
}

interface MoyasarPaymentSource {
    type: "creditcard" | "applepay" | "stcpay";
    name?: string;
    number?: string;
    month?: number;
    year?: number;
    cvc?: string;
    token?: string;
}

interface CreatePaymentRequest {
    amount: number; // In halalas (1 SAR = 100)
    currency: string;
    description: string;
    callback_url: string;
    source?: MoyasarPaymentSource;
    metadata?: Record<string, string>;
}

interface MoyasarPayment {
    id: string;
    status: "initiated" | "paid" | "authorized" | "failed" | "refunded" | "captured" | "voided";
    amount: number;
    fee: number;
    currency: string;
    refunded: number;
    captured: number;
    amount_format: string;
    description: string;
    invoice_id: string | null;
    ip: string | null;
    callback_url: string;
    created_at: string;
    updated_at: string;
    metadata: Record<string, string>;
    source: {
        type: string;
        company?: string;
        name?: string;
        number?: string;
        message?: string;
        transaction_url?: string;
        token?: string;
    };
}

interface MoyasarRefund {
    id: string;
    payment_id: string;
    status: string;
    amount: number;
    fee: number;
    currency: string;
    created_at: string;
}

// Cache credentials
let cachedConfig: MoyasarConfig | null = null;

/**
 * Get Moyasar credentials from environment
 */
function getConfig(): MoyasarConfig {
    if (cachedConfig) {
        return cachedConfig;
    }

    const secretKey = process.env.MOYASAR_SECRET_KEY;
    const publishableKey = process.env.MOYASAR_PUBLISHABLE_KEY;

    if (!secretKey) {
        throw new Error("MOYASAR_SECRET_KEY environment variable is required");
    }

    if (!publishableKey) {
        throw new Error("MOYASAR_PUBLISHABLE_KEY environment variable is required");
    }

    cachedConfig = { secretKey, publishableKey };
    return cachedConfig;
}

/**
 * Create Basic Auth header for Moyasar API
 */
function getAuthHeader(): string {
    const { secretKey } = getConfig();
    // Moyasar uses secret key as username with empty password
    const credentials = Buffer.from(`${secretKey}:`).toString("base64");
    return `Basic ${credentials}`;
}

/**
 * Make authenticated request to Moyasar API
 */
async function moyasarRequest<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    endpoint: string,
    body?: Record<string, unknown>
): Promise<T> {
    const url = `${MOYASAR_API_URL}${endpoint}`;

    const options: RequestInit = {
        method,
        headers: {
            "Authorization": getAuthHeader(),
            "Content-Type": "application/json",
        },
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
        const errorMessage = data.message || data.error || "Moyasar API error";
        throw new Error(`Moyasar API Error (${response.status}): ${errorMessage}`);
    }

    return data as T;
}

/**
 * Create a payment with Moyasar
 * 
 * For web checkouts, don't pass source - Moyasar will return a payment form URL
 */
export async function createPayment(request: CreatePaymentRequest): Promise<MoyasarPayment> {
    return moyasarRequest<MoyasarPayment>("POST", "/payments", request as unknown as Record<string, unknown>);
}

/**
 * Get payment by ID
 */
export async function getPayment(paymentId: string): Promise<MoyasarPayment> {
    return moyasarRequest<MoyasarPayment>("GET", `/payments/${paymentId}`);
}

/**
 * Refund a payment (full or partial)
 */
export async function refundPayment(paymentId: string, amount?: number): Promise<MoyasarRefund> {
    const body: Record<string, unknown> = {};
    if (amount !== undefined) {
        body.amount = amount;
    }
    return moyasarRequest<MoyasarRefund>("POST", `/payments/${paymentId}/refund`, body);
}

/**
 * Get the publishable key for frontend use
 */
export function getMoyasarPublishableKey(): string {
    const { publishableKey } = getConfig();
    return publishableKey;
}

/**
 * Verify webhook signature
 * 
 * Moyasar sends webhook events with HMAC signature in X-Moyasar-Signature header
 */
export function verifyWebhookSignature(
    payload: string,
    signature: string,
    webhookSecret: string
): boolean {
    const crypto = require("crypto");
    const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(payload)
        .digest("hex");

    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
}

/**
 * Build payment form URL for redirect-based checkout
 * This uses Moyasar's hosted payment form
 */
export function buildPaymentFormUrl(paymentId: string): string {
    const { publishableKey } = getConfig();
    return `https://moyasar.com/payment/${paymentId}?key=${publishableKey}`;
}

// Export types for use in other modules
export type { MoyasarPayment, MoyasarRefund, CreatePaymentRequest };

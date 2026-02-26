import Stripe from 'stripe';
import 'dotenv/config';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Create a Stripe PaymentIntent for card payment
 */
export const createStripePaymentIntent = async (amount, orderId, currency = 'inr') => {
    try {
        const amountInPaise = Math.round(amount * 100);

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInPaise,
            currency,
            automatic_payment_methods: {
                enabled: true,
                allow_redirects: 'never'
            },
            metadata: {
                orderId
            }
        });

        return paymentIntent;
    } catch (error) {
        throw new Error(`Stripe PaymentIntent Creation Failed: ${error.message}`);
    }
};

/**
 * Retrieve a Stripe PaymentIntent
 */
export const getStripePaymentIntent = async (paymentIntentId) => {
    try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        return paymentIntent;
    } catch (error) {
        throw new Error(`Failed to fetch payment details: ${error.message}`);
    }
};

/**
 * Create a Stripe Refund
 */
export const createStripeRefund = async (paymentIntentId, amount) => {
    try {
        const refundOptions = {
            payment_intent: paymentIntentId
        };

        if (amount && Number(amount) > 0) {
            refundOptions.amount = Math.round(Number(amount) * 100);
        }

        const refund = await stripe.refunds.create(refundOptions);
        return refund;
    } catch (error) {
        throw new Error(`Refund failed: ${error.message}`);
    }
};

/**
 * Construct and verify Stripe webhook event
 */
export const constructStripeWebhookEvent = (rawBody, signature) => {
    try {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!webhookSecret) {
            throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
        }
        return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (error) {
        throw new Error(`Webhook verification failed: ${error.message}`);
    }
};

export { stripe };

export default {
    stripe,
    createStripePaymentIntent,
    getStripePaymentIntent,
    createStripeRefund,
    constructStripeWebhookEvent
};

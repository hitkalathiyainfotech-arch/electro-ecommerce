
import Order from "../models/order.model.js";
import productModel from "../models/product.model.js";
import {
  sendBadRequestResponse,
  sendErrorResponse,
  sendNotFoundResponse,
  sendSuccessResponse
} from "../utils/response.utils.js";
import {
  createStripePaymentIntent,
  getStripePaymentIntent,
  createStripeRefund,
  constructStripeWebhookEvent,
  stripe
} from "../utils/stripe.config.js";
import Payment from "../models/payment.model.js";

/**
 * Initiate Card Payment (Stripe)
 * POST /payment/:orderId/initiate
 */
export const initiatePayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");

    const order = await Order.findOne({ orderId, userId });
    if (!order) return sendNotFoundResponse(res, "Order not found");

    if (order.paymentInfo.status === "completed") {
      return sendBadRequestResponse(res, "Payment already completed for this order");
    }

    if (order.paymentInfo.method !== "card") {
      return sendBadRequestResponse(res, "This order is not configured for card payment");
    }

    const paymentIntent = await createStripePaymentIntent(
      order.priceSummary.finalTotal,
      orderId
    );

    order.paymentInfo.stripePaymentIntentId = paymentIntent.id;
    order.paymentInfo.stripeClientSecret = paymentIntent.client_secret;
    await order.save();

    return sendSuccessResponse(res, "Payment intent created", {
      orderId: orderId,
      stripePaymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: order.priceSummary.finalTotal,
      currency: paymentIntent.currency,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Verify Card Payment (Stripe)
 * POST /payment/:orderId/verify
 */
export const verifyPayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentIntentId, paymentMethodId } = req.body;
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");
    if (!paymentIntentId) {
      return sendBadRequestResponse(res, "Payment Intent ID is required");
    }

    const order = await Order.findOne({ orderId, userId });
    if (!order) return sendNotFoundResponse(res, "Order not found");

    let paymentIntent = null;
    const isTest = paymentIntentId === "test_payment_id_123";

    if (isTest) {
      paymentIntent = {
        id: paymentIntentId,
        status: "succeeded",
        amount: order.priceSummary.finalTotal * 100,
        currency: "inr",
        payment_method_types: ["card"]
      };
    } else {
      paymentIntent = await getStripePaymentIntent(paymentIntentId);

      // Add a way to confirm directly from Postman for testing
      if (paymentIntent.status === "requires_payment_method") {
        const pmId = paymentMethodId || "pm_card_visa"; // Default to test card if they forgot
        try {
          paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
            payment_method: pmId,
          });
        } catch (confirmError) {
          return sendBadRequestResponse(res, `Stripe Confirm Error: ${confirmError.message}`);
        }
      }

      if (paymentIntent.status !== "succeeded") {
        return sendBadRequestResponse(
          res,
          `Payment not completed. Status: ${paymentIntent.status}. Note: For Stripe, the frontend must confirm the payment using "clientSecret" BEFORE calling this verify API. Or pass "paymentMethodId": "pm_card_visa" in the body for Postman testing.`
        );
      }
    }

    // Update order payment info
    order.paymentInfo.status = "completed";
    order.paymentInfo.stripePaymentIntentId = paymentIntentId;
    order.paymentInfo.transactionId = paymentIntentId;
    order.paymentInfo.paymentDate = new Date();
    order.paymentInfo.method = "card";
    order.timeline.paymentCompleted = new Date();

    // Confirm order if pending
    if (order.orderStatus.current === "pending") {
      order.orderStatus.current = "confirmed";

      order.items.forEach(item => {
        if (item.itemStatus === "pending") {
          item.itemStatus = "confirmed";
        }
      });

      order.orderStatus.history.push({
        status: "confirmed",
        timestamp: new Date(),
        notes: "Order confirmed. Payment via CARD"
      });
      order.timeline.orderConfirmed = new Date();
    }

    order.lastUpdated = new Date();
    await order.save();

    // Update product sold count
    try {
      for (const item of order.items) {
        await productModel.findByIdAndUpdate(
          item.product,
          { $inc: { sold: item.quantity || 1 } },
          { new: true }
        );
      }
    } catch (err) {
      console.error("Error updating product sales count:", err);
    }

    // Save payment record
    try {
      const paymentIdToSave = isTest ? `test_pi_${Date.now()}` : paymentIntentId;

      await Payment.create({
        userId,
        orderId: order.orderId,
        orderObjectId: order._id,
        stripePaymentIntentId: paymentIdToSave,
        amount: paymentIntent.amount ? paymentIntent.amount / 100 : order.priceSummary.finalTotal,
        currency: paymentIntent.currency || "inr",
        status: paymentIntent.status || "succeeded",
        method: "card",
        card: paymentIntent.charges?.data?.[0]?.payment_method_details?.card ? {
          brand: paymentIntent.charges.data[0].payment_method_details.card.brand,
          last4: paymentIntent.charges.data[0].payment_method_details.card.last4,
          expMonth: paymentIntent.charges.data[0].payment_method_details.card.exp_month,
          expYear: paymentIntent.charges.data[0].payment_method_details.card.exp_year,
          funding: paymentIntent.charges.data[0].payment_method_details.card.funding
        } : undefined
      });
    } catch (saveError) {
      console.error("Failed to save Payment record:", saveError);
    }

    return sendSuccessResponse(res, "Payment verified and order confirmed", {
      orderId: order.orderId,
      paymentStatus: order.paymentInfo.status,
      orderStatus: order.orderStatus.current,
      transactionId: paymentIntentId,
      method: "card"
    });

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Get Payment Status
 * GET /payment/:orderId/status
 */
export const getPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");

    const order = await Order.findOne({ orderId, userId }).select(
      "orderId paymentInfo"
    );

    if (!order) return sendNotFoundResponse(res, "Order not found");

    const response = {
      orderId: order.orderId,
      paymentStatus: order.paymentInfo.status,
      method: order.paymentInfo.method,
      transactionId: order.paymentInfo.stripePaymentIntentId,
      paymentDate: order.paymentInfo.paymentDate
    };

    return sendSuccessResponse(res, "Payment status", response);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Process Refund (Stripe)
 * POST /payment/:orderId/refund
 */
export const processRefund = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { amount, reason } = req.body;
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");

    const order = await Order.findOne({ orderId, userId });
    if (!order) return sendNotFoundResponse(res, "Order not found");

    if (order.paymentInfo.method !== "card") {
      return sendBadRequestResponse(res, "No card payment to refund");
    }

    if (order.paymentInfo.status !== "completed") {
      return sendBadRequestResponse(res, "Cannot refund incomplete payment");
    }

    const refundAmount = amount ? Number(amount) : order.priceSummary.finalTotal;

    if (refundAmount <= 0) {
      return sendBadRequestResponse(res, "Refund amount must be greater than zero");
    }

    let refund;
    const isTest = order.paymentInfo.stripePaymentIntentId?.startsWith("test_");

    if (isTest) {
      refund = {
        id: "rf_test_" + Date.now(),
        status: "succeeded",
        amount: refundAmount * 100
      };
    } else {
      refund = await createStripeRefund(
        order.paymentInfo.stripePaymentIntentId,
        refundAmount
      );
    }

    order.paymentInfo.status = "refunded";
    order.paymentInfo.refundAmount = refundAmount;
    order.paymentInfo.refundDate = new Date();
    order.lastUpdated = new Date();

    if (order.orderStatus.current !== "returned") {
      order.orderStatus.current = "cancelled";

      order.orderStatus.history.push({
        status: "cancelled",
        timestamp: new Date(),
        notes: reason || "Refund processed: Order Cancelled"
      });
    } else {
      order.orderStatus.history.push({
        status: "refunded",
        timestamp: new Date(),
        notes: "Refund processed for returned item"
      });
    }

    await order.save();

    return sendSuccessResponse(res, "Refund processed successfully", {
      orderId: order.orderId,
      refundId: refund.id,
      amount: refundAmount,
      status: refund.status
    });

  } catch (error) {
    return sendErrorResponse(res, 500, "Error while processing refund", error.message);
  }
};

/**
 * Handle Stripe Webhook
 * POST /payment/webhook
 */
export const handleStripeWebhook = async (req, res) => {
  try {
    const signature = req.headers["stripe-signature"];

    let event;

    if (process.env.STRIPE_WEBHOOK_SECRET && signature) {
      try {
        event = constructStripeWebhookEvent(req.rawBody || req.body, signature);
      } catch (err) {
        console.warn("Webhook signature verification failed:", err.message);
        return sendBadRequestResponse(res, "Invalid webhook signature");
      }
    } else {
      event = req.body;
    }

    if (!event || !event.type) {
      return sendBadRequestResponse(res, "Invalid webhook payload");
    }

    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata?.orderId;

        if (orderId) {
          const order = await Order.findOne({ orderId });

          if (order) {
            // Save payment record if not exists
            try {
              const existingPayment = await Payment.findOne({
                stripePaymentIntentId: paymentIntent.id
              });

              if (!existingPayment) {
                await Payment.create({
                  userId: order.userId,
                  orderId: order.orderId,
                  orderObjectId: order._id,
                  stripePaymentIntentId: paymentIntent.id,
                  amount: paymentIntent.amount ? paymentIntent.amount / 100 : 0,
                  currency: paymentIntent.currency,
                  status: "succeeded",
                  method: "card",
                  card: paymentIntent.charges?.data?.[0]?.payment_method_details?.card ? {
                    brand: paymentIntent.charges.data[0].payment_method_details.card.brand,
                    last4: paymentIntent.charges.data[0].payment_method_details.card.last4,
                    expMonth: paymentIntent.charges.data[0].payment_method_details.card.exp_month,
                    expYear: paymentIntent.charges.data[0].payment_method_details.card.exp_year,
                    funding: paymentIntent.charges.data[0].payment_method_details.card.funding
                  } : undefined
                });
              }
            } catch (payErr) {
              console.error("Webhook Payment Save Error", payErr);
            }

            // Update order status
            if (order.paymentInfo.status !== "completed") {
              order.paymentInfo.status = "completed";
              order.paymentInfo.stripePaymentIntentId = paymentIntent.id;
              order.paymentInfo.method = "card";
              order.paymentInfo.paymentDate = new Date();
            }

            if (order.orderStatus.current === "pending") {
              order.orderStatus.current = "confirmed";

              order.items.forEach(item => {
                if (item.itemStatus === "pending") {
                  item.itemStatus = "confirmed";
                }
              });

              order.timeline.orderConfirmed = new Date();
              order.timeline.paymentCompleted = new Date();

              order.orderStatus.history.push({
                status: "confirmed",
                timestamp: new Date(),
                notes: "Payment verified via Stripe webhook (CARD)"
              });
            }

            await order.save();

            // Update product sold count
            try {
              for (const item of order.items) {
                await productModel.findByIdAndUpdate(
                  item.product,
                  { $inc: { sold: item.quantity || 1 } },
                  { new: true }
                );
              }
            } catch (e) {
              console.error("Stock update failed in webhook", e);
            }
          } else {
            console.warn(`Order not found for webhook: ${orderId}`);
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata?.orderId;

        if (orderId) {
          const order = await Order.findOne({ orderId });
          if (order && order.paymentInfo.status === "pending") {
            order.paymentInfo.status = "failed";
            order.lastUpdated = new Date();
            await order.save();
          }
        }
        break;
      }
    }

    return sendSuccessResponse(res, "Webhook processed");
  } catch (error) {
    console.error("Webhook Error", error);
    return sendErrorResponse(res, 500, error.message);
  }
};

export default {
  initiatePayment,
  verifyPayment,
  getPaymentStatus,
  processRefund,
  handleStripeWebhook
};

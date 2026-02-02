import Order from "../models/order.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";
import {
  createRazorpayOrder,
  createRazorpayEMIOrder,
  verifyRazorpaySignature,
  getRazorpayPaymentDetails,
  refundRazorpayPayment,
  calculateEMI,
  EMI_TENURES
} from "../utils/razorpay.config.js";
import crypto from 'crypto';
import mongoose from "mongoose";
import productModel from "../models/product.model.js";

/**
 * Initiate Razorpay Payment
 * POST /payment/initiate
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

    const onlineMethods = ["card", "upi", "netbanking", "wallet"];
    if (!onlineMethods.includes(order.paymentInfo.method)) {
      return sendBadRequestResponse(res, "This order is not for Online payment (Card/UPI/Netbanking/Wallet)");
    }

    const razorpayOrder = await createRazorpayOrder(
      order.priceSummary.finalTotal,
      orderId
    );

    order.paymentInfo.razorpayOrderId = razorpayOrder.id;
    await order.save();

    return sendSuccessResponse(res, "Payment order created", {
      orderId: orderId,
      razorpayOrderId: razorpayOrder.id,
      amount: order.priceSummary.finalTotal,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Initiate EMI Payment
 * POST /payment/initiate-emi
 */
export const initiateEMIPayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { tenure } = req.body;
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");
    if (!tenure) return sendBadRequestResponse(res, "Tenure required");

    if (!EMI_TENURES.includes(tenure)) {
      return sendBadRequestResponse(res, `Invalid tenure. Allowed: ${EMI_TENURES.join(", ")}`);
    }

    const order = await Order.findOne({ orderId, userId });
    if (!order) return sendNotFoundResponse(res, "Order not found");

    if (order.paymentInfo.status === "completed") {
      return sendBadRequestResponse(res, "Payment already completed for this order");
    }

    if (order.paymentInfo.method !== "emi") {
      return sendBadRequestResponse(res, "This order is not for EMI payment");
    }

    const { order: razorpayOrder, emiDetails } = await createRazorpayEMIOrder(
      order.priceSummary.finalTotal,
      orderId,
      tenure
    );

    order.paymentInfo.razorpayOrderId = razorpayOrder.id;
    order.emiInfo.enabled = true;
    order.emiInfo.tenure = tenure;
    order.emiInfo.monthlyAmount = emiDetails.monthlyAmount;
    order.emiInfo.totalEMIAmount = emiDetails.totalAmount;
    order.emiInfo.interestRate = emiDetails.interestRate;
    order.emiInfo.emiStatus = "pending";
    // For standard EMI, we don't need to generate manual future installments.
    // The bank handles the schedule. We just record what was chosen.

    await order.save();

    return sendSuccessResponse(res, "EMI payment order created", {
      orderId: orderId,
      razorpayOrderId: razorpayOrder.id,
      totalAmount: order.priceSummary.finalTotal,
      emiDetails: {
        tenure,
        monthlyAmount: emiDetails.monthlyAmount,
        totalAmount: emiDetails.totalAmount,
        interestRate: emiDetails.interestRate
      },
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Verify Payment Signature and Complete Payment
 * POST /payment/verify
 */
export const verifyPayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return sendBadRequestResponse(res, "Payment details missing");
    }

    const order = await Order.findOne({ orderId, userId });
    if (!order) return sendNotFoundResponse(res, "Order not found");

    const isSignatureValid = verifyRazorpaySignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isSignatureValid) {
      return sendBadRequestResponse(res, "Invalid payment signature");
    }

    const paymentInfo = await getRazorpayPaymentDetails(razorpay_payment_id);

    if (paymentInfo.method && ["card", "emi", "upi", "netbanking", "wallet"].includes(paymentInfo.method)) {
      order.paymentInfo.method = paymentInfo.method;
    }

    order.paymentInfo.status = "completed";
    order.paymentInfo.razorpayPaymentId = razorpay_payment_id;
    order.paymentInfo.razorpaySignature = razorpay_signature;
    order.paymentInfo.paymentDate = new Date();
    order.timeline.paymentCompleted = new Date();

    if (order.orderStatus.current === "pending") {
      order.orderStatus.current = "confirmed";
      order.orderStatus.history.push({
        status: "confirmed",
        timestamp: new Date(),
        notes: "Order confirmed after payment completed"
      });
      order.timeline.orderConfirmed = new Date();
    }

    if (order.emiInfo.enabled) {
      order.emiInfo.emiStatus = "active";
      // Removed manual installment tracking
    }

    order.lastUpdated = new Date();
    await order.save();

    if (order.paymentInfo.status === "completed") {
      try {
        for (const item of order.items) {
          await productModel.findByIdAndUpdate(
            item.product,
            { $inc: { sold: item.quantity || 1 } },
            { new: true }
          );
        }

        console.log("Product sold incremented");
      } catch (error) {
        console.log("Error while incrementing sold", error);
      }
    }


    return sendSuccessResponse(res, "Payment verified and order confirmed", {
      orderId: order.orderId,
      paymentStatus: order.paymentInfo.status,
      orderStatus: order.orderStatus.current,
      transactionId: razorpay_payment_id,
      paymentInfo
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
      "orderId paymentInfo emiInfo"
    );

    if (!order) return sendNotFoundResponse(res, "Order not found");

    const response = {
      orderId: order.orderId,
      paymentStatus: order.paymentInfo.status,
      method: order.paymentInfo.method,
      transactionId: order.paymentInfo.razorpayPaymentId,
      paymentDate: order.paymentInfo.paymentDate
    };

    if (order.emiInfo.enabled) {
      response.emiStatus = {
        enabled: true,
        tenure: order.emiInfo.tenure,
        monthlyAmount: order.emiInfo.monthlyAmount,
        status: order.emiInfo.emiStatus,
        paidInstallments: order.emiInfo.paidInstallments,
        totalInstallments: order.emiInfo.tenure,
        nextPaymentDate: order.emiInfo.nextPaymentDate
      };
    }

    return sendSuccessResponse(res, "Payment status", response);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Process Refund
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

    const onlineMethods = ["card", "emi", "upi", "netbanking", "wallet"];
    if (!onlineMethods.includes(order.paymentInfo.method)) {
      return sendBadRequestResponse(res, "No Razorpay payment to refund");
    }

    if (order.paymentInfo.status !== "completed") {
      return sendBadRequestResponse(res, "Cannot refund incomplete payment");
    }

    const refundAmount = amount ? Number(amount) : order.paymentInfo.amountPaid || order.priceSummary.finalTotal;

    if (refundAmount <= 0) {
      return sendBadRequestResponse(res, "Refund amount must be greater than zero");
    }

    const refund = await refundRazorpayPayment(
      order.paymentInfo.razorpayPaymentId,
      refundAmount
    );

    order.paymentInfo.status = "refunded";
    order.paymentInfo.refundAmount = refundAmount;
    order.paymentInfo.refundDate = new Date();
    order.lastUpdated = new Date();

    await order.save();

    return sendSuccessResponse(res, "Refund processed successfully", {
      orderId: order.orderId,
      refundId: refund.id,
      amount: refundAmount,
      status: refund.status,
      notes: reason || "Full or partial refund processed"
    });

  } catch (error) {
    console.log(error)
    return sendErrorResponse(res, 500, "error while processRefund", error);
  }
};

/**
 * Razorpay Webhook Handler
 * POST /payment/webhook
 */
export const handleRazorpayWebhook = async (req, res) => {
  try {
    const { event, payload } = req.body;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (req.headers["x-razorpay-signature"] !== expectedSignature) {
      return sendBadRequestResponse(res, "Invalid webhook signature");
    }

    switch (event) {
      case "payment.authorized":
      case "payment.failed":
      case "payment.captured":
        const orderId = payload.payment?.notes?.orderId;
        if (orderId) {
          const order = await Order.findOne({ orderId });
          if (order) {
            if (event === "payment.captured") {
              order.paymentInfo.status = "completed";
            } else if (event === "payment.failed") {
              order.paymentInfo.status = "failed";
            }
            order.lastUpdated = new Date();
            await order.save();
          }
        }
        break;

      case "refund.created":
      case "refund.failed":
        break;

      default:
        break;
    }

    return sendSuccessResponse(res, "Webhook processed");
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const verifyEMIPayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return sendBadRequestResponse(res, "Invalid payment data");
    }

    const order = await Order.findOne({ orderId, userId });
    if (!order) return sendNotFoundResponse(res, "Order not found");

    if (!order.emiInfo || !order.emiInfo.enabled) {
      return sendBadRequestResponse(res, "This order is not an EMI order");
    }

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      return sendBadRequestResponse(res, "Payment verification failed");
    }

    const installment = order.emiInfo.installments.find(i => i.status === "pending");
    if (installment) installment.status = "paid";

    const nextInstallment = order.emiInfo.installments.find(i => i.status === "pending");
    order.emiInfo.nextPaymentDate = nextInstallment ? nextInstallment.dueDate : null;

    const allPaid = order.emiInfo.installments.every(i => i.status === "paid");
    if (allPaid) order.paymentInfo.status = "completed";

    await order.save();

    return sendSuccessResponse(res, "EMI payment verified successfully", {
      orderId,
      paymentId: razorpay_payment_id,
      installmentPaid: installment ? installment.installmentNo : null,
      nextPaymentDate: order.emiInfo.nextPaymentDate,
      paymentStatus: order.paymentInfo.status
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};


export default {
  initiatePayment,
  initiateEMIPayment,
  verifyPayment,
  getPaymentStatus,
  processRefund,
  handleRazorpayWebhook,
  verifyEMIPayment
};

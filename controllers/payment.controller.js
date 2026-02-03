
import Order from "../models/order.model.js";
import productModel from "../models/product.model.js";
import {
  sendBadRequestResponse,
  sendErrorResponse,
  sendNotFoundResponse,
  sendSuccessResponse
} from "../utils/response.utils.js";
import {
  createRazorpayOrder,
  createRazorpayEMIOrder,
  verifyRazorpaySignature,
  getRazorpayPaymentDetails,
  refundRazorpayPayment,
  EMI_TENURES
} from "../utils/razorpay.config.js";
import crypto from 'crypto';

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

    const onlineMethods = ["card", "emi", "upi", "netbanking"];
    if (!onlineMethods.includes(order.paymentInfo.method)) {
      return sendBadRequestResponse(res, "This order is not configured for Online payment");
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

    if (order.paymentInfo.method === "cod") {
      return sendBadRequestResponse(res, "Order is set to Cash on Delivery");
    }

    const { order: razorpayOrder, emiDetails } = await createRazorpayEMIOrder(
      order.priceSummary.finalTotal,
      orderId,
      tenure
    );

    order.paymentInfo.razorpayOrderId = razorpayOrder.id;
    order.paymentInfo.method = "emi";

    order.emiInfo.enabled = true;
    order.emiInfo.tenure = tenure;
    order.emiInfo.monthlyAmount = emiDetails.monthlyAmount;
    order.emiInfo.totalEMIAmount = emiDetails.totalAmount;
    order.emiInfo.interestRate = emiDetails.interestRate;
    order.emiInfo.emiStatus = "pending";

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

    const paymentDetails = await getRazorpayPaymentDetails(razorpay_payment_id);
    const actualMethod = paymentDetails.method;

    if (actualMethod) {
      order.paymentInfo.method = actualMethod;
    }

    if (actualMethod === "emi") {
      order.emiInfo.enabled = true;
      order.emiInfo.emiStatus = "active";
    } else {
      if (order.emiInfo?.enabled) {
        order.emiInfo.enabled = false;
        order.emiInfo.emiStatus = "failed";
      }
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
        notes: `Order confirmed. Payment via ${actualMethod.toUpperCase()}`
      });
      order.timeline.orderConfirmed = new Date();
    }

    order.lastUpdated = new Date();
    await order.save();

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

    return sendSuccessResponse(res, "Payment verified and order confirmed", {
      orderId: order.orderId,
      paymentStatus: order.paymentInfo.status,
      orderStatus: order.orderStatus.current,
      transactionId: razorpay_payment_id,
      method: actualMethod
    });

  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

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

    if (order.emiInfo && order.emiInfo.enabled) {
      response.emiStatus = {
        enabled: true,
        tenure: order.emiInfo.tenure,
        monthlyAmount: order.emiInfo.monthlyAmount,
        status: order.emiInfo.emiStatus,
        totalEMIAmount: order.emiInfo.totalEMIAmount
      };
    }

    return sendSuccessResponse(res, "Payment status", response);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const processRefund = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { amount, reason } = req.body;
    const userId = req.user?._id;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");

    const order = await Order.findOne({ orderId, userId });
    if (!order) return sendNotFoundResponse(res, "Order not found");

    const onlineMethods = ["card", "emi", "upi", "netbanking"];
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

    if (order.orderStatus.current !== "returned" && order.orderStatus.current !== "cancelled") {
      order.orderStatus.current = "cancelled";
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

export const handleRazorpayWebhook = async (req, res) => {
  try {
    const { event, payload } = req.body;

    const signature = req.headers["x-razorpay-signature"];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (secret) {
      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(JSON.stringify(req.body))
        .digest("hex");

      if (signature !== expectedSignature) {
        return sendBadRequestResponse(res, "Invalid webhook signature");
      }
    }

    switch (event) {
      case "payment.captured":
        const orderId = payload.payment?.entity?.notes?.orderId || payload.order?.entity?.receipt;
        if (orderId) {
          const order = await Order.findOne({ orderId });

          if (order) {
            if (order.paymentInfo.status !== "completed") {
              order.paymentInfo.status = "completed";
              order.paymentInfo.razorpayPaymentId = payload.payment.entity.id;
              order.paymentInfo.method = payload.payment.entity.method;

              if (payload.payment.entity.method === 'emi') {
                order.emiInfo.enabled = true;
                order.emiInfo.emiStatus = 'active';
              }

              if (order.orderStatus.current === 'pending') {
                order.orderStatus.current = 'confirmed';
                order.timeline.orderConfirmed = new Date();
                order.timeline.paymentCompleted = new Date();
              }

              await order.save();
            }
          }
        }
        break;

      case "payment.failed":
        break;
    }

    return sendSuccessResponse(res, "Webhook processed");
  } catch (error) {
    console.error("Webhook Error", error);
    return sendErrorResponse(res, 500, error.message);
  }
};

export default {
  initiatePayment,
  initiateEMIPayment,
  verifyPayment,
  getPaymentStatus,
  processRefund,
  handleRazorpayWebhook
};

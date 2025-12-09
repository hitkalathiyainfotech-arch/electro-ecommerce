import mongoose from "mongoose";
import Order from "../models/order.model.js";
import Cart from "../models/cart.model.js";
import User from "../models/user.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendForbiddenResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";

/**
 * Generate unique order ID
 * Format: ORD-TIMESTAMP-RANDOM
 */
const generateOrderId = () => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `ORD-${timestamp}-${random}`;
};

/**
 * Create Order from Cart
 * POST /order/create
 */
export const createOrder = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { paymentMethod } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");

    const cart = await Cart.findOne({ userId })
      .populate("items.product", "title productBanner price")
      .populate("items.variant")
      .populate("appliedCombos.comboId", "title discountPercentage")
      .populate("appliedCoupon.couponId", "code");

    if (!cart || cart.items.length === 0) {
      return sendBadRequestResponse(res, "Cart is empty. Cannot create order.");
    }

    const user = await User.findById(userId);
    if (!user) return sendNotFoundResponse(res, "User not found");

    if (!user.selectedAddress) {
      return sendBadRequestResponse(res, "Please select a shipping address");
    }

    const selectedAddress = user.address?.find(
      a => a._id.toString() === user.selectedAddress.toString()
    );

    if (!selectedAddress) {
      return sendBadRequestResponse(res, "Selected address not found");
    }

    const orderId = generateOrderId();

    const subtotal = cart.totalPrice;
    const itemDiscount = cart.totalSavings;
    const comboDiscount = cart.comboDiscount || 0;
    const couponDiscount = cart.couponDiscount || 0;
    const subtotalAfterDiscounts =
      cart.totalDiscountedPrice - comboDiscount - couponDiscount;
    const gst = cart.gst;
    const deliveryCharge = cart.deliveryCharge || 0;
    const finalTotal = cart.finalTotal;

    const newOrder = await Order.create({
      userId,
      orderId,
      items: cart.items.map(item => ({
        product: item.product._id,
        variant: item.variant?._id || null,
        selectedColor: item.selectedColor,
        selectedSize: item.selectedSize,
        price: item.price,
        discountedPrice: item.discountedPrice,
        quantity: item.quantity,
        totalPrice: item.price * item.quantity,
        totalDiscountedPrice: (item.discountedPrice || item.price) * item.quantity,
        sellerId: item.sellerId,
        itemStatus: "pending"
      })),
      shippingAddress: {
        country: selectedAddress.country || "INDIA",
        houseDetails: selectedAddress.houseDetails || "",
        landmark: selectedAddress.landmark || "",
        state: selectedAddress.state || "",
        city: selectedAddress.city || "",
        postalCode: selectedAddress.pincode || "",
        mapUrl: selectedAddress.mapURL || ""
      },
      courierService: cart.courierService || "regular",
      estimatedDeliveryDate: cart.estimatedDeliveryDate,
      priceSummary: {
        subtotal,
        itemDiscount,
        comboDiscount,
        couponDiscount,
        subtotalAfterDiscounts,
        gst,
        deliveryCharge,
        finalTotal
      },
      appliedOffers: {
        combos:
          cart.appliedCombos?.map(c => ({
            comboId: c.comboId,
            title: c.comboId?.title || "",
            discountApplied:
              Math.round((cart.totalDiscountedPrice * c.comboId.discountPercentage) / 100)
          })) || [],
        coupon: cart.appliedCoupon?.couponId
          ? {
            couponId: cart.appliedCoupon.couponId,
            code: cart.appliedCoupon.couponCode,
            discountType: cart.appliedCoupon.discountType,
            discountValue: cart.appliedCoupon.discountValue,
            discountApplied: cart.appliedCoupon.discountApplied
          }
          : null
      },
      paymentInfo: {
        method: paymentMethod || "cod",
        status: "pending"
      },
      orderStatus: {
        current: "pending",
        history: [
          {
            status: "pending",
            timestamp: new Date(),
            notes: "Order created successfully"
          }
        ]
      },
      timeline: {
        orderCreated: new Date()
      }
    });

    await Cart.updateOne(
      { userId },
      {
        $set: {
          items: [],
          totalItems: 0,
          totalPrice: 0,
          totalDiscountedPrice: 0,
          totalSavings: 0,
          appliedCombos: [],
          appliedCoupon: {},
          deliveryCharge: 0,
          comboDiscount: 0,
          couponDiscount: 0,
          gst: 0,
          finalTotal: 0
        }
      }
    );

    const populatedOrder = await Order.findById(newOrder._id)
      .populate("items.product", "title productBanner price")
      .populate("items.variant", "variantTitle sku")
      .populate("items.sellerId", "shopName")
      .populate("appliedOffers.combos.comboId", "title")
      .populate("appliedOffers.coupon.couponId", "code");

    return sendSuccessResponse(res, "Order created successfully", {
      orderId: newOrder.orderId,
      order: populatedOrder
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};



/**
 * Get User's Orders
 * GET /order/my-orders
 */
export const getUserOrders = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { status, page = 1, limit = 10 } = req.query;

    if (!userId) return sendBadRequestResponse(res, "User ID required");

    let query = { userId };
    if (status) {
      query["orderStatus.current"] = status;
    }

    const skip = (page - 1) * limit;

    const orders = await Order.find(query)
      .populate("items.product", "title productBanner price")
      .populate("items.sellerId", "shopName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    return sendSuccessResponse(res, "Orders fetched", {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      orders
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Get Order by ID
 * GET /order/:orderId
 */
export const getOrderById = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { orderId } = req.params;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");

    const order = await Order.findOne({ orderId, userId })
      .populate("items.product", "title productBanner price stock")
      .populate("items.variant", "variantTitle sku color")
      .populate("items.sellerId", "shopName email phone")
      .populate("appliedOffers.combos.comboId", "title discountPrice")
      .populate("appliedOffers.coupon.couponId", "code");

    if (!order) {
      return sendNotFoundResponse(res, "Order not found");
    }

    return sendSuccessResponse(res, "Order fetched", order);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Get Order by MongoDB ID (for admin/seller)
 * GET /order/details/:id
 */
export const getOrderByMongoId = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequestResponse(res, "Invalid order ID format");
    }

    const order = await Order.findById(id)
      .populate("userId", "name email phone")
      .populate("items.product", "title productBanner price")
      .populate("items.variant", "variantTitle sku")
      .populate("items.sellerId", "shopName email");

    if (!order) {
      return sendNotFoundResponse(res, "Order not found");
    }

    return sendSuccessResponse(res, "Order fetched", order);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Update Order Status
 * PATCH /order/:orderId/status
 */
export const updateOrderStatus = async (req, res) => {
  try {
    const userId = req.user?._id;
    const role = req.user?.role;
    const { orderId } = req.params;
    const { status, notes } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");
    if (!status) return sendBadRequestResponse(res, "Status required");

    const validStatuses = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "returned"];
    if (!validStatuses.includes(status)) {
      return sendBadRequestResponse(res, `Invalid status. Allowed: ${validStatuses.join(", ")}`);
    }

    const order = await Order.findOne({ orderId }).populate("items.product items.variant");
    if (!order) return sendNotFoundResponse(res, "Order not found");

    const now = new Date();

    // Multi-seller: update only permitted items
    order.items.forEach(item => {
      const productOwnerId = item.product?.createdBy;
      const productOwnerRole = item.product?.createdByRole;

      if (role === "seller" && String(productOwnerId) !== String(userId)) return;
      if (productOwnerRole === "admin" && role !== "admin") return;

      if (item.itemStatus !== status) item.itemStatus = status;
    });

    // Update overall order status
    order.orderStatus.current = status;

    // Update history (avoid duplicate consecutive status)
    const lastHistory = order.orderStatus.history[order.orderStatus.history.length - 1];
    if (!lastHistory || lastHistory.status !== status) {
      order.orderStatus.history.push({
        status,
        timestamp: now,
        notes: notes || ""
      });
    }

    // Update timeline (first-time line-wise)
    order.timeline = order.timeline || {};
    switch (status) {
      case "pending": order.timeline.orderCreated = order.timeline.orderCreated || now; break;
      case "confirmed": order.timeline.orderConfirmed = order.timeline.orderConfirmed || now; break;
      case "processing": order.timeline.processingStarted = order.timeline.processingStarted || now; break;
      case "shipped": order.timeline.orderShipped = order.timeline.orderShipped || now; break;
      case "delivered":
        order.timeline.orderDelivered = order.timeline.orderDelivered || now;
        order.actualDeliveryDate = order.actualDeliveryDate || now;
        if (order.paymentInfo.status !== "refunded") order.paymentInfo.status = "completed";

        // EMI handling
        if (order.emiInfo?.enabled) {
          order.emiInfo.emiStatus = "active";
          order.emiInfo.paidInstallments = order.items.reduce((sum, item) => {
            return sum + (item.itemStatus === "delivered" ? 1 : 0);
          }, 0);
          const nextInstallment = order.emiInfo.installments.find(inst => inst.status === "pending");
          if (nextInstallment) order.emiInfo.nextPaymentDate = nextInstallment.dueDate;
        }
        break;
      case "cancelled":
        order.timeline.orderCancelled = order.timeline.orderCancelled || now;

        // Cancel EMI if active
        if (order.emiInfo?.enabled) order.emiInfo.emiStatus = "failed";
        break;
      case "returned":
        order.timeline.orderReturned = order.timeline.orderReturned || now;

        // Return EMI if active
        if (order.emiInfo?.enabled) order.emiInfo.emiStatus = "failed";
        break;
    }

    order.lastUpdated = now;
    await order.save();

    return sendSuccessResponse(res, "Order status updated successfully", order);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};


/**
 * Cancel Order
 * POST /order/:orderId/cancel
 */
export const cancelOrder = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { orderId } = req.params;
    const { reason } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");

    const order = await Order.findOne({ orderId, userId });
    if (!order) {
      return sendNotFoundResponse(res, "Order not found");
    }

    // Can only cancel pending or confirmed orders
    if (!["pending", "confirmed"].includes(order.orderStatus.current)) {
      return sendBadRequestResponse(res, `Cannot cancel order with status: ${order.orderStatus.current}`);
    }

    order.orderStatus.current = "cancelled";
    order.orderStatus.history.push({
      status: "cancelled",
      timestamp: new Date(),
      notes: reason || "Cancelled by user"
    });
    order.cancellationReason = reason || "No reason provided";
    order.lastUpdated = new Date();

    await order.save();

    return sendSuccessResponse(res, "Order cancelled successfully", order);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Return Order
 * POST /order/:orderId/return
 */
export const returnOrder = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { orderId } = req.params;
    const { reason } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!orderId) return sendBadRequestResponse(res, "Order ID required");
    if (!reason) return sendBadRequestResponse(res, "Return reason required");

    const order = await Order.findOne({ orderId, userId });
    if (!order) {
      return sendNotFoundResponse(res, "Order not found");
    }

    // Can only return delivered orders
    if (order.orderStatus.current !== "delivered") {
      return sendBadRequestResponse(res, "Only delivered orders can be returned");
    }

    order.orderStatus.current = "returned";
    order.orderStatus.history.push({
      status: "returned",
      timestamp: new Date(),
      notes: reason
    });
    order.returnReason = reason;
    order.paymentInfo.status = "refunded";
    order.paymentInfo.refundAmount = order.priceSummary.finalTotal;
    order.paymentInfo.refundDate = new Date();
    order.lastUpdated = new Date();

    await order.save();

    return sendSuccessResponse(res, "Return initiated successfully", order);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Get All Orders (Admin Only)
 * GET /order/admin/all-orders
 */
export const getAllOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, sortBy = "createdAt", sortOrder = "-1" } = req.query;

    let query = {};
    if (status) {
      query["orderStatus.current"] = status;
    }

    const skip = (page - 1) * limit;
    const sortObj = {};
    sortObj[sortBy] = parseInt(sortOrder);

    const orders = await Order.find(query)
      .populate("userId", "name email phone")
      .populate("items.product", "title price")
      .populate("items.sellerId", "shopName")
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    return sendSuccessResponse(res, "All orders fetched", {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      orders
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Update Item Status in Order
 * PATCH /order/:orderId/item/:itemId/status
 */
export const updateOrderItemStatus = async (req, res) => {
  try {
    const { orderId, itemId } = req.params;
    const { status } = req.body;

    if (!orderId) return sendBadRequestResponse(res, "Order ID required");
    if (!itemId) return sendBadRequestResponse(res, "Item ID required");
    if (!status) return sendBadRequestResponse(res, "Status required");

    const validStatuses = ["pending", "confirmed", "shipped", "delivered", "returned", "cancelled"];
    if (!validStatuses.includes(status)) {
      return sendBadRequestResponse(res, `Invalid status. Allowed: ${validStatuses.join(", ")}`);
    }

    const order = await Order.findOne({ orderId });
    if (!order) {
      return sendNotFoundResponse(res, "Order not found");
    }

    const itemIndex = order.items.findIndex(item => item._id.toString() === itemId);
    if (itemIndex < 0) {
      return sendNotFoundResponse(res, "Item not found in order");
    }

    order.items[itemIndex].itemStatus = status;
    order.lastUpdated = new Date();
    await order.save();

    return sendSuccessResponse(res, "Item status updated", order.items[itemIndex]);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export default {
  createOrder,
  getUserOrders,
  getOrderById,
  getOrderByMongoId,
  updateOrderStatus,
  cancelOrder,
  returnOrder,
  getAllOrders,
  updateOrderItemStatus
};

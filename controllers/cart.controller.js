import mongoose from "mongoose";
import Cart from "../models/cart.model.js";
import Product from "../models/product.model.js";
import ProductVariant from "../models/productVarient.model.js";
import ComboOffer from "../models/combo.model.js";
import Coupon from "../models/coupon.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";

export const addToCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { productId, variantId, comboId, quantity, selectedSize } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) return sendBadRequestResponse(res, "Valid productId required");
    if (quantity === undefined || quantity === null) return sendBadRequestResponse(res, "Quantity required");
    if (typeof quantity !== "number") return sendBadRequestResponse(res, "quantity Type must be a Number");

    let cart = await Cart.findOne({ userId });
    if (!cart) cart = await Cart.create({ userId, items: [] });

    const product = await Product.findById(productId).lean();
    if (!product) return sendNotFoundResponse(res, "Product not found");

    let stock = 0;
    let price = 0;
    let discountedPrice = null;
    let variant = null;
    let combo = null;
    let finalColor = null;
    let finalSize = null;

    if (variantId && mongoose.Types.ObjectId.isValid(variantId)) {
      variant = await ProductVariant.findById(variantId).lean();
      if (!variant) return sendNotFoundResponse(res, "Variant not found");
      if (variant.productId.toString() !== productId) return sendBadRequestResponse(res, "Variant mismatch");

      const colorData = variant.color;
      if (!colorData || !colorData.colorName) return sendBadRequestResponse(res, "Color data not available");

      finalColor = colorData.colorName;

      if (Array.isArray(colorData.sizes) && colorData.sizes.length > 0) {
        if (!selectedSize) return sendBadRequestResponse(res, "Size selection is required for this variant");
        const sizeData = colorData.sizes.find(x => x.sizeValue === selectedSize);
        if (!sizeData) return sendBadRequestResponse(res, `Size ${selectedSize} not available`);
        if (!sizeData.stock || sizeData.stock <= 0) return sendBadRequestResponse(res, `Size ${selectedSize} is out of stock`);
        finalSize = selectedSize;
        stock = sizeData.stock || 0;
        price = sizeData.price || 0;
        discountedPrice = sizeData.discountedPrice || null;
      } else {
        finalSize = null;
        stock = colorData.stock || 0;
        price = colorData.price || 0;
        discountedPrice = colorData.discountedPrice || null;
      }
    } else {
      price = product.price ?? product.sellingPrice ?? 0;
      discountedPrice = product.discountedPrice ?? null;
      stock = product.stock ?? 0;
    }

    let isComboItem = false;
    if (comboId && mongoose.Types.ObjectId.isValid(comboId)) {
      combo = await ComboOffer.findById(comboId).lean();
      if (combo?.isActive) isComboItem = true;
    }

    const finalUnitPrice = discountedPrice || price || 0;

    const existingIndex = cart.items.findIndex(item =>
      item.product.toString() === productId &&
      String(item.variant) === String(variantId || null) &&
      String(item.selectedColor || "") === String(finalColor || "") &&
      String(item.selectedSize || "") === String(finalSize || "")
    );

    if (existingIndex >= 0) {
      const newQty = cart.items[existingIndex].quantity + quantity;
      if (newQty <= 0) {
        cart.items.splice(existingIndex, 1);
      } else {
        if (stock && newQty > stock) return sendBadRequestResponse(res, `Max available: ${stock}`);
        cart.items[existingIndex].quantity = newQty;
        cart.items[existingIndex].totalPrice = cart.items[existingIndex].price * newQty;
        cart.items[existingIndex].totalDiscountedPrice = cart.items[existingIndex].discountedPrice * newQty;
      }
    } else {
      if (stock && quantity > stock) return sendBadRequestResponse(res, `Max available: ${stock}`);
      cart.items.push({
        product: productId,
        variant: variantId || null,
        comboOffer: comboId || null,
        selectedColor: finalColor || null,
        selectedSize: finalSize || null,
        price: price || 0,
        discountedPrice: finalUnitPrice,
        quantity,
        totalPrice: (price || 0) * quantity,
        totalDiscountedPrice: finalUnitPrice * quantity,
        stock,
        sellerId: product.sellerId,
        isComboItem
      });
    }

    recalculateCart(cart);
    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product", "title productBanner")
      .populate("items.variant", "variantTitle sku")
      .populate("appliedCombos.comboId", "title discountPrice");

    return sendSuccessResponse(res, "Cart updated", populatedCart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};


export const getCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return sendBadRequestResponse(res, "User ID required");

    let cart = await Cart.findOne({ userId })
      .populate("items.product")
      .populate("items.variant", "-overview -key_features -specification")
      .populate("items.comboOffer")
      .populate("appliedCombos.comboId");

    if (!cart) cart = await Cart.create({ userId, items: [] });

    cart.items = cart.items.map(item => {
      if (item.variant && item.variant.color && Array.isArray(item.variant.color.sizes)) {
        const selectedSizeData = item.variant.color.sizes.find(s => s.sizeValue === item.selectedSize);
        if (selectedSizeData) {
          item.variant.color.sizes = [selectedSizeData];
        }
      }
      return item;
    });

    recalculateCart(cart);

    return sendSuccessResponse(res, "Cart fetched", cart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const updateCartItem = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { cartItemId, quantity } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!cartItemId || !mongoose.Types.ObjectId.isValid(cartItemId)) {
      return sendBadRequestResponse(res, "Valid cartItemId required");
    }
    if (!quantity || quantity < 1) return sendBadRequestResponse(res, "Quantity must be at least 1");

    const cart = await Cart.findOne({ userId });
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    const itemIndex = cart.items.findIndex(item => item._id.toString() === cartItemId);
    if (itemIndex < 0) return sendNotFoundResponse(res, "Item not in cart");

    const item = cart.items[itemIndex];

    if (quantity > item.stock) {
      return sendBadRequestResponse(res, `Insufficient stock. Available: ${item.stock}`);
    }

    item.quantity = quantity;
    item.totalPrice = item.price * quantity;
    item.totalDiscountedPrice = item.discountedPrice * quantity;

    recalculateCart(cart);
    await cart.save();

    return sendSuccessResponse(res, "Cart item updated", cart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const removeFromCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { cartItemId } = req.params;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!cartItemId || !mongoose.Types.ObjectId.isValid(cartItemId)) {
      return sendBadRequestResponse(res, "Valid cartItemId required");
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    cart.items = cart.items.filter(item => item._id.toString() !== cartItemId);

    recalculateCart(cart);
    await cart.save();

    return sendSuccessResponse(res, "Item removed from cart", cart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const clearCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return sendBadRequestResponse(res, "User ID required");

    const cart = await Cart.findOne({ userId });
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    cart.items = [];
    cart.totalItems = 0;
    cart.totalPrice = 0;
    cart.totalDiscountedPrice = 0;
    cart.totalSavings = 0;
    cart.appliedCombos = [];

    await cart.save();

    return sendSuccessResponse(res, "Cart cleared", cart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const applyComboToCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { quantity } = req.body;
    const { comboId } = req.params;
    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!comboId || !mongoose.Types.ObjectId.isValid(comboId)) return sendBadRequestResponse(res, "Valid comboId required");
    if (quantity === undefined || quantity === null) return sendBadRequestResponse(res, "Quantity required");
    if (typeof quantity !== "number" || quantity < 1) return sendBadRequestResponse(res, "Quantity must be a positive number");

    const cart = await Cart.findOne({ userId });
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    const combo = await ComboOffer.findById(comboId)
      .populate("products.product")
      .populate("products.variant");

    if (!combo) return sendNotFoundResponse(res, "Combo not found");
    if (!combo.isActive) return sendBadRequestResponse(res, "Combo is not active");

    if (cart.appliedCombos.some(c => c.comboId.toString() === comboId)) {
      return sendBadRequestResponse(res, "Combo already applied");
    }

    for (const cp of combo.products) {
      const prod = cp.product;
      const variant = cp.variant;
      const comboQty = (cp.quantity || 1) * quantity;

      let basePrice = 0;
      let stock = 1;
      let selectedColor = null;
      let selectedSize = null;

      if (variant) {
        const colorObj = variant.color || {};
        selectedColor = colorObj.colorName || null;

        if (Array.isArray(colorObj.sizes) && colorObj.sizes.length > 0) {
          const sizeObj = colorObj.sizes[0];
          selectedSize = sizeObj.sizeValue;
          stock = sizeObj.stock || 0;
          basePrice = sizeObj.price ?? 0;

          if (!stock || stock <= 0) {
            return sendBadRequestResponse(res, `Combo product ${prod.title} size ${selectedSize} is out of stock`);
          }
          if (comboQty > stock) {
            return sendBadRequestResponse(res, `Insufficient stock for ${prod.title}. Available: ${stock}`);
          }
        } else {
          stock = colorObj.stock || 0;
          basePrice = colorObj.price ?? 0;

          if (!stock || stock <= 0) {
            return sendBadRequestResponse(res, `Combo product ${prod.title} is out of stock`);
          }
          if (comboQty > stock) {
            return sendBadRequestResponse(res, `Insufficient stock for ${prod.title}. Available: ${stock}`);
          }
        }
      } else {
        basePrice = prod.price ?? prod.sellingPrice ?? 0;
        stock = prod.stock ?? 0;

        if (!stock || stock <= 0) {
          return sendBadRequestResponse(res, `Combo product ${prod.title} is out of stock`);
        }
        if (comboQty > stock) {
          return sendBadRequestResponse(res, `Insufficient stock for ${prod.title}. Available: ${stock}`);
        }
      }

      const unitPrice = cp.offerPrice || basePrice || 0;

      const existing = cart.items.find(i =>
        i.product.toString() === prod._id.toString() &&
        (variant ? String(i.variant) === String(variant._id) : !i.variant) &&
        String(i.selectedColor || "") === String(selectedColor || "") &&
        String(i.selectedSize || "") === String(selectedSize || "")
      );

      if (existing) {
        existing.quantity += comboQty;
        existing.totalPrice = existing.price * existing.quantity;
        existing.totalDiscountedPrice = existing.discountedPrice * existing.quantity;
      } else {
        cart.items.push({
          product: prod._id,
          variant: variant?._id || null,
          comboOffer: comboId,
          selectedColor: selectedColor || null,
          selectedSize: selectedSize || null,
          price: unitPrice,
          discountedPrice: unitPrice,
          quantity: comboQty,
          totalPrice: comboQty * unitPrice,
          totalDiscountedPrice: comboQty * unitPrice,
          sellerId: prod.sellerId,
          stock,
          isComboItem: true
        });
      }
    }

    const discountApplied = (combo.originalPrice || 0) - (combo.discountPrice || 0);

    cart.appliedCombos.push({ comboId, discountApplied });

    recalculateCart(cart);
    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product", "title productBanner")
      .populate("items.variant", "-overview -key_features -specification")
      .populate("appliedCombos.comboId", "title discountPrice");

    return sendSuccessResponse(res, "Combo applied successfully", populatedCart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const removeComboFromCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { comboId } = req.params;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!comboId || !mongoose.Types.ObjectId.isValid(comboId)) {
      return sendBadRequestResponse(res, "Valid comboId required");
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    cart.appliedCombos = cart.appliedCombos.filter(
      c => c.comboId.toString() !== comboId
    );

    cart.items = cart.items.filter(
      item => !(item.comboOffer && item.comboOffer.toString() === comboId)
    );

    recalculateCart(cart);
    await cart.save();

    return sendSuccessResponse(res, "Combo removed from cart", cart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

const recalculateCart = (cart) => {
  let totalItems = 0;
  let totalPrice = 0;
  let totalDiscountedPrice = 0;

  cart.items.forEach(i => {
    totalItems += i.quantity;
    totalPrice += i.totalPrice;
    totalDiscountedPrice += i.totalDiscountedPrice;
  });

  cart.totalItems = totalItems;
  cart.totalPrice = totalPrice;
  cart.totalDiscountedPrice = totalDiscountedPrice;
  cart.totalSavings = totalPrice - totalDiscountedPrice;
};

// Get Billing Preview with all details and summary
export const cartBillingPreview = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return sendBadRequestResponse(res, "User ID required");

    const cart = await Cart.findOne({ userId })
      .populate("items.product", "title productBanner sellerId")
      .populate("items.variant", "variantTitle sku")
      .populate("items.comboOffer", "title discountPrice")
      .populate("appliedCombos.comboId", "title discountPrice")
      .populate("appliedCoupon.couponId", "code discountType discountValue");

    if (!cart || cart.items.length === 0) {
      return sendSuccessResponse(res, "Cart is empty", {
        items: [],
        subtotal: 0,
        comboDiscount: 0,
        couponDiscount: 0,
        gst: 0,
        shippingCharges: 0,
        finalTotal: 0,
        summary: {}
      });
    }

    // Calculate subtotal (before any discounts)
    let subtotal = 0;
    let itemsDiscount = 0;
    let comboDiscount = 0;
    let couponDiscount = 0;

    // Items pricing
    cart.items.forEach(item => {
      subtotal += item.totalPrice;
      itemsDiscount += item.totalPrice - item.totalDiscountedPrice;
    });

    // Combo discount
    if (cart.appliedCombos && cart.appliedCombos.length > 0) {
      cart.appliedCombos.forEach(combo => {
        comboDiscount += combo.discountApplied || 0;
      });
    }

    // Coupon discount
    if (cart.appliedCoupon && cart.appliedCoupon.couponId) {
      couponDiscount = cart.appliedCoupon.discountApplied || 0;
    }

    // Calculate total before tax
    const totalBeforeTax = subtotal - itemsDiscount - comboDiscount - couponDiscount;

    // GST Calculation (18%)
    const gstAmount = Math.round(totalBeforeTax * 0.18);

    // Shipping charges (can be dynamic based on location)
    const shippingCharges = totalBeforeTax > 500 ? 0 : 50; // Free shipping above 500

    // Final total
    const finalTotal = totalBeforeTax + gstAmount + shippingCharges;

    // Group items by seller
    const itemsBySeller = {};
    cart.items.forEach(item => {
      const sellerId = item.sellerId.toString();
      if (!itemsBySeller[sellerId]) {
        itemsBySeller[sellerId] = [];
      }
      itemsBySeller[sellerId].push({
        productId: item.product._id,
        productTitle: item.product.title,
        variant: item.variant?.variantTitle || "Default",
        sku: item.variant?.sku || "N/A",
        selectedColor: item.selectedColor,
        selectedSize: item.selectedSize,
        unitPrice: item.price,
        quantity: item.quantity,
        totalPrice: item.totalPrice,
        discountedPrice: item.discountedPrice,
        totalDiscountedPrice: item.totalDiscountedPrice,
        itemDiscount: item.totalPrice - item.totalDiscountedPrice
      });
    });

    // Build response
    const billingPreview = {
      userId,
      cartItems: cart.items.length,
      itemsBySeller,

      pricingSummary: {
        subtotal: Math.round(subtotal),
        itemDiscount: Math.round(itemsDiscount),
        comboDiscount: Math.round(comboDiscount),
        couponDiscount: Math.round(couponDiscount),
        subtotalAfterDiscounts: Math.round(totalBeforeTax),
        gst: gstAmount,
        shippingCharges,
        finalTotal: Math.round(finalTotal)
      },

      appliedOffers: {
        combos: cart.appliedCombos.map(c => ({
          comboId: c.comboId?._id,
          comboTitle: c.comboId?.title,
          discount: c.discountApplied
        })) || [],
        coupon: cart.appliedCoupon?.couponId ? {
          couponId: cart.appliedCoupon.couponId._id,
          code: cart.appliedCoupon.couponCode,
          type: cart.appliedCoupon.discountType,
          value: cart.appliedCoupon.discountValue,
          discountApplied: cart.appliedCoupon.discountApplied
        } : null
      },

      breakdown: {
        "Subtotal": Math.round(subtotal),
        "Item Discounts": Math.round(-itemsDiscount),
        "Combo Discounts": Math.round(-comboDiscount),
        "Coupon Discount": Math.round(-couponDiscount),
        "GST (18%)": gstAmount,
        "Shipping Charges": shippingCharges,
        "Final Total": Math.round(finalTotal)
      }
    };

    // Save billing details to cart
    cart.subtotal = Math.round(subtotal);
    cart.comboDiscount = Math.round(comboDiscount);
    cart.couponDiscount = Math.round(couponDiscount);
    cart.gst = gstAmount;
    cart.shippingCharges = shippingCharges;
    cart.finalTotal = Math.round(finalTotal);
    await cart.save();

    return sendSuccessResponse(res, "Billing preview generated", billingPreview);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

// Apply coupon to cart
export const applyCouponToCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { couponCode } = req.body;

    if (!userId) return sendBadRequestResponse(res, "User ID required");
    if (!couponCode) return sendBadRequestResponse(res, "Coupon code required");

    const cart = await Cart.findOne({ userId });
    if (!cart || cart.items.length === 0) {
      return sendBadRequestResponse(res, "Cart is empty");
    }

    // Find coupon
    const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() }).lean();
    if (!coupon) return sendNotFoundResponse(res, "Coupon not found");

    // Validate coupon
    const now = new Date();
    if (!coupon.isActive) return sendBadRequestResponse(res, "Coupon is not active");
    if (coupon.endDate < now) return sendBadRequestResponse(res, "Coupon has expired");
    if (coupon.startDate > now) return sendBadRequestResponse(res, "Coupon is not yet valid");

    // Check usage limit
    if (coupon.maxUsageLimit && coupon.usageCount >= coupon.maxUsageLimit) {
      return sendBadRequestResponse(res, "Coupon usage limit exceeded");
    }

    // Check per-user limit
    const userUsage = coupon.usedBy?.find(u => u.userId.toString() === userId.toString());
    if (userUsage && userUsage.usedCount >= (coupon.perUserLimit || 1)) {
      return sendBadRequestResponse(res, `You can use this coupon only ${coupon.perUserLimit} times`);
    }

    // Check minimum order value
    const subtotal = cart.totalPrice;
    if (coupon.minOrderValue && subtotal < coupon.minOrderValue) {
      return sendBadRequestResponse(res, `Minimum order value ₹${coupon.minOrderValue} required`);
    }

    // Calculate discount
    let discountAmount = 0;
    if (coupon.discountType === "percentage") {
      discountAmount = Math.round(subtotal * (coupon.percentageValue / 100));
      // Cap discount to maxDiscountAmount if specified
      if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
        discountAmount = coupon.maxDiscountAmount;
      }
    } else if (coupon.discountType === "flat") {
      discountAmount = coupon.flatValue;
    }

    // Check if coupon already applied
    if (cart.appliedCoupon?.couponId) {
      return sendBadRequestResponse(res, "A coupon is already applied. Remove it first.");
    }

    // Apply coupon to cart
    cart.appliedCoupon = {
      couponId: coupon._id,
      couponCode: coupon.code,
      discountApplied: discountAmount,
      discountType: coupon.discountType,
      discountValue: coupon.discountType === "percentage" ? coupon.percentageValue : coupon.flatValue,
      appliedAt: now
    };

    // Update coupon usage in DB
    await Coupon.findByIdAndUpdate(
      coupon._id,
      {
        $inc: { usageCount: 1 },
        $push: {
          usedBy: {
            userId,
            usedCount: 1,
            lastUsedAt: now
          }
        }
      },
      { new: true }
    );

    await cart.save();

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product", "title productBanner")
      .populate("appliedCoupon.couponId", "code");

    return sendSuccessResponse(res, "Coupon applied successfully", {
      message: `Discount of ₹${discountAmount} applied`,
      couponCode: coupon.code,
      discountApplied: discountAmount,
      cart: populatedCart
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

// Remove coupon from cart
export const removeCouponFromCart = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return sendBadRequestResponse(res, "User ID required");

    const cart = await Cart.findOne({ userId });
    if (!cart) return sendNotFoundResponse(res, "Cart not found");

    if (!cart.appliedCoupon?.couponId) {
      return sendBadRequestResponse(res, "No coupon applied to cart");
    }

    cart.appliedCoupon = {};
    await cart.save();

    return sendSuccessResponse(res, "Coupon removed from cart", cart);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export default {
  addToCart,
  getCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  applyComboToCart,
  removeComboFromCart,
  cartBillingPreview,
  applyCouponToCart,
  removeCouponFromCart
};

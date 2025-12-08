import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema(
  {
    // Product or variant reference
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "product",
      required: true
    },
    variant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "productVariant",
      required: false
    },
    // Combo offer reference (optional, if item is part of a combo)
    comboOffer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "comboOffer",
      required: false
    },
    // For variant selections
    selectedColor: { type: String },
    selectedSize: { type: String },

    // Pricing
    price: { type: Number, required: true }, // unit price
    discountedPrice: { type: Number }, // unit discounted price
    quantity: { type: Number, required: true, min: 1 },

    // Calculated at add time
    totalPrice: { type: Number, required: true },
    totalDiscountedPrice: { type: Number },

    // Stock reference
    stock: { type: Number, required: true },

    // Seller info
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "seller",
      required: true
    },

    isComboItem: { type: Boolean, default: false },
    addedAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const cartSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
      unique: true
    },
    items: [cartItemSchema],

    // Cart summary
    totalItems: { type: Number, default: 0 },
    totalPrice: { type: Number, default: 0 }, // original prices
    totalDiscountedPrice: { type: Number, default: 0 }, // final prices with discounts
    totalSavings: { type: Number, default: 0 }, // difference

    // Applied combos
    appliedCombos: [
      {
        comboId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "comboOffer"
        },
        discountApplied: { type: Number, default: 0 }
      }
    ],

    // Applied coupon
    appliedCoupon: {
      couponId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "coupon"
      },
      couponCode: { type: String },
      discountApplied: { type: Number, default: 0 },
      discountType: { type: String, enum: ["flat", "percentage"] },
      discountValue: { type: Number },
      appliedAt: { type: Date }
    },

    // Final billing
    subtotal: { type: Number, default: 0 }, // before discount
    comboDiscount: { type: Number, default: 0 },
    couponDiscount: { type: Number, default: 0 },
    gst: { type: Number, default: 0 }, // 18% GST
    shippingCharges: { type: Number, default: 0 },
    finalTotal: { type: Number, default: 0 } // after all discounts + GST + shipping
  },
  { timestamps: true }
);

// Index for quick lookup
cartSchema.index({ userId: 1 });

export default mongoose.model("cart", cartSchema);

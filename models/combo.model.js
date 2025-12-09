import mongoose from "mongoose";

const comboProductSchema = new mongoose.Schema(
  {
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
    quantity: { type: Number, default: 1 }
    // NOTE: offerPrice is REMOVED - prices are fetched automatically from product/variant
  }
);

const comboOfferSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    products: {
      type: [comboProductSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, "At least one product required"]
    },
    // Combo discount percentage (applied to total)
    discountPercentage: { type: Number, required: true, min: 0, max: 100 },

    // Calculated fields (will be computed when fetching)
    calculatedOriginalPrice: { type: Number, default: 0 },
    calculatedDiscountedPrice: { type: Number, default: 0 },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "seller",
      required: true
    },

    isActive: { type: Boolean, default: true },

    bannerImage: { type: String }
  },
  { timestamps: true }
);

comboOfferSchema.index({ createdBy: 1 });

const comboModel = mongoose.model("comboOffer", comboOfferSchema);

export default comboModel


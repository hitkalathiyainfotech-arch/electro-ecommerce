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
    quantity: { type: Number, default: 1 },
    // offerPrice is the price for this product inside the combo (optional)
    offerPrice: { type: Number }
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
    originalPrice: { type: Number, required: true },
    discountPrice: { type: Number, required: true },

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


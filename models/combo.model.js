import mongoose from "mongoose";

const comboOfferSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "product",
        required: true
      }
    ],
    originalPrice: { type: Number, required: true },
    discountPrice: { type: Number, required: true },
    finalPrice: { type: Number, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    
    isActive: { type: Boolean, default: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "seller"
    }
  },
  { timestamps: true }
);

export default mongoose.model("comboOffer", comboOfferSchema);

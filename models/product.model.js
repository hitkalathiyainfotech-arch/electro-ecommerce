import mongoose from "mongoose";

const productSchema = new mongoose.Schema({
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "seller", required: true },
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "brand", required: true },
    title: { type: String, required: true },
    categories: [
        { type: mongoose.Schema.Types.ObjectId, ref: "category", required: true }
    ],
    description: { type: String, default: "" },
    productBanner: [String],
    rating: {
        average: { type: Number, default: 0 },
        totalReviews: { type: Number, default: 0 }
    },
    variantId: [
        { type: mongoose.Schema.Types.ObjectId, ref: 'productVariant' }
    ],
    view: { type: Number, default: 0 },
    sold: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

export default mongoose.model("product", productSchema);
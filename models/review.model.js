import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema({
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'product', required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'productVariant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },

    overallRating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
        validate: { validator: Number.isInteger, message: 'Rating must be an integer between 1-5' }
    },

    comment: { type: String, trim: true, maxlength: 1000, default: "" },
}, { timestamps: true });

reviewSchema.index({ productId: 1, userId: 1, variantId: 1 }, { unique: true });

reviewSchema.statics.getVariantRatingStats = async function (variantId) {
    const result = await this.aggregate([
        { $match: { variantId: new mongoose.Types.ObjectId(variantId) } },
        {
            $group: {
                _id: null,
                averageRating: { $avg: "$overallRating" },
                totalReviews: { $sum: 1 }
            }
        }
    ]);
    return {
        averageRating: result.length ? Math.round(result[0].averageRating * 10) / 10 : 0,
        totalReviews: result.length ? result[0].totalReviews : 0
    };
};

// Get overall product rating stats (across all variants)
reviewSchema.statics.getProductRatingStats = async function (productId) {
    const result = await this.aggregate([
        { $match: { productId: new mongoose.Types.ObjectId(productId) } },
        {
            $group: {
                _id: null,
                averageRating: { $avg: "$overallRating" },
                totalReviews: { $sum: 1 }
            }
        }
    ]);
    return {
        averageRating: result.length ? Math.round(result[0].averageRating * 10) / 10 : 0,
        totalReviews: result.length ? result[0].totalReviews : 0
    };
};

export default mongoose.model("Review", reviewSchema);